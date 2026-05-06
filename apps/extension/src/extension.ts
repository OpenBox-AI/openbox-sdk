import * as vscode from "vscode";
import type { OpenBoxClient } from "openbox-sdk/client";
import type { EnvName } from "openbox-sdk/env";
import { createApi, createApiContext } from "./api";
import { ApprovalsPollingService as PollingService } from "openbox-sdk/polling";
import { ApprovalsTreeProvider } from "./approvalsView";
import { createTabObserver } from "./tabObserver";
import { PreWriteGate, extractTargetUri } from "./preWriteGate";
import { PreFileOpGate } from "./preFileOpGate";
import { GovernanceClient } from "./governanceClient";
import type { Approval } from "./types";

/** Backend's Halt verdict; approvals with this code block the save flow. */
const VERDICT_HALT = 4;

// X-API-Key auth → polling-only (the WS gateway requires JWT today).
type ApprovalsFeed = PollingService;
let feed: ApprovalsFeed | undefined;

function readEnv(): EnvName {
  const v = vscode.workspace.getConfiguration("openbox").get<string>("environment", "production");
  return v === "staging" || v === "local" ? v : "production";
}

export async function activate(context: vscode.ExtensionContext) {
  // The env switcher (openbox.switchEnvironment) is gated behind this
  // context key in package.json so end users running a published .vsix
  // never see it in the command palette. ExtensionMode.Development is
  // true when launched via "Run Extension" or extensionDevelopmentPath.
  const isDev = context.extensionMode === vscode.ExtensionMode.Development;
  vscode.commands.executeCommand("setContext", "openbox.devMode", isDev);

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = "openbox.approvals.focus";
  statusBar.show();
  context.subscriptions.push(statusBar);

  const treeProvider = new ApprovalsTreeProvider();
  const treeView = vscode.window.createTreeView("openbox.approvals", {
    treeDataProvider: treeProvider,
  });
  context.subscriptions.push(treeView);

  // Booting and re-booting share state through these refs. A setting change or
  // a manual switch tears down polling and rebuilds with the new env.
  let env: EnvName = readEnv();
  let client: OpenBoxClient | undefined;
  let orgId: string | undefined;

  // Governance client (workspace-config-driven; reads agent_id, env).
  // Shared across PreWriteGate, TabObserver, PreFileOpGate so they
  // resolve `openbox.agentId` consistently.
  const governance = new GovernanceClient();

  // Pre-write gate. Constructed up front so the polling-changed handler
  // (which lives inside `boot`) can record/clear halt verdicts on it.
  // Entries land when the approvals feed reports a halt verdict for an
  // open document. Active mode (per-save check_governance) is gated by
  // openbox.preWriteGate.active inside handleSave.
  const preWrite = new PreWriteGate(governance);
  preWrite.attach(context);
  context.subscriptions.push({ dispose: () => preWrite.dispose() });

  // File-operation gate (create / delete / rename). Gated by
  // openbox.fileOpGate.enabled at call time so toggling the setting
  // doesn't require a reload.
  const fileOpGate = new PreFileOpGate(governance);
  fileOpGate.attach(context);
  context.subscriptions.push({ dispose: () => fileOpGate.dispose() });

  // URIs that previously had a halt deny recorded, so we can call
  // clearDeny when the same approval transitions out of pending. Keyed
  // by approval ID; the value is the document URI we recorded against.
  const haltedApprovals = new Map<string, string>();

  function paintIdle(envTag: EnvName, count: number) {
    statusBar.text =
      count > 0 ? `$(shield) ${count} Pending · ${envTag}` : `$(shield) OpenBox · ${envTag}`;
  }

  /** True when `uri` is currently open in any editor tab. We only
   *  record denies for files the user has open; recording for arbitrary
   *  paths would surface modal save prompts on files the user hasn't
   *  touched, which is worse than no gate at all. */
  function isUriOpen(uri: string): boolean {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input as { uri?: vscode.Uri } | undefined;
        if (input?.uri && input.uri.toString() === uri) return true;
      }
    }
    return false;
  }

  async function boot(nextEnv: EnvName) {
    feed?.stop();
    feed = undefined;
    treeProvider.update([]);
    treeView.badge = undefined;
    vscode.commands.executeCommand("setContext", "openbox.hasApprovals", false);

    env = nextEnv;
    statusBar.text = `$(sync~spin) OpenBox · ${env}`;
    statusBar.tooltip = `Connecting to ${env}…`;

    let ctx: { client: OpenBoxClient; apiBase: string };
    try {
      ctx = await createApiContext(env);
      client = ctx.client;
    } catch (err: any) {
      client = undefined;
      statusBar.text = `$(shield) OpenBox · ${env}: No Token`;
      statusBar.tooltip = err.message;
      vscode.window.showErrorMessage(`OpenBox: ${err.message}`);
      return;
    }

    try {
      const profile: any = await client.getProfile();
      orgId = profile.orgId;
      if (!orgId) {
        statusBar.text = `$(shield) OpenBox · ${env}: No Org`;
        return;
      }
      statusBar.tooltip = `Signed in as ${profile.email || profile.preferred_username || profile.sub} (${env})`;
    } catch (err: any) {
      statusBar.text = `$(shield) OpenBox · ${env}: Error`;
      statusBar.tooltip = err.message;
      return;
    }

    const wireFeed = (f: ApprovalsFeed) => {
      f.on("changed", (approvals: Approval[]) => {
        treeProvider.update(approvals);
        const count = approvals.length;
        paintIdle(env, count);
        treeView.badge = count > 0 ? { value: count, tooltip: `${count} pending approvals` } : undefined;
        vscode.commands.executeCommand("setContext", "openbox.hasApprovals", count > 0);

        // Halt-verdict gating: any pending approval at verdict 4 whose
        // target URI is currently open gets a recordDeny on the gate.
        // Approvals previously halted that drop out of the pending set
        // (decided / expired) get a clearDeny so saves stop being
        // gated. Both maps are keyed by approval ID, not URI, because a
        // single file can have multiple overlapping halts.
        const seen = new Set<string>();
        for (const a of approvals) {
          if (a.verdict !== VERDICT_HALT) continue;
          const uri = extractTargetUri(a.input);
          if (!uri) continue;
          if (!isUriOpen(uri)) continue;
          seen.add(a.id);
          if (haltedApprovals.has(a.id)) continue;
          haltedApprovals.set(a.id, uri);
          preWrite.recordDeny({
            uri,
            reason: a.reason || `${a.activity_type || "edit"} flagged`,
            approvalId: a.id,
            at: Date.now(),
          });
        }
        for (const [id, uri] of haltedApprovals) {
          if (seen.has(id)) continue;
          preWrite.clearDeny(uri);
          haltedApprovals.delete(id);
        }
      });

      f.on("newApprovals", (newOnes: Approval[]) => {
        for (const a of newOnes) {
          const agent = a.agent?.agent_name || a.agent_id || "Agent";
          const action = a.activity_type || "action";
          const reason = a.reason || `${action} needs approval`;
          const tag = `[${env}] ${agent}`;

          vscode.window
            .showWarningMessage(`${tag}: ${reason}`, "Approve", "Reject", "View")
            .then((choice) => {
              if (!client) return;
              const agentId = a.agent_id || "";
              if (choice === "Approve") {
                client.decideApproval(agentId, a.id, { action: "approve" }).then(() => feed?.refresh());
              } else if (choice === "Reject") {
                client.decideApproval(agentId, a.id, { action: "reject" }).then(() => feed?.refresh());
              } else if (choice === "View") {
                vscode.commands.executeCommand("openbox.approvals.focus");
              }
            });
        }
      });

      f.on("error", (err: Error) => {
        console.error(`OpenBox feed error (${env}):`, err.message);
      });
    };

    void ctx;
    const polling = new PollingService(client, orgId);
    wireFeed(polling);
    polling.start();
    feed = polling;
  }

  await boot(env);
  context.subscriptions.push({ dispose: () => feed?.stop() });

  // Tab / Composer / Cmd-K observer. Cursor doesn't expose hooks for
  // these surfaces, so we classify mutations heuristically. With
  // openbox.tabObserver.active, classified non-keystroke inserts also
  // call check_governance and revert on deny.
  const observerEnabled = vscode.workspace
    .getConfiguration("openbox")
    .get<boolean>("tabObserver.enabled", false);
  if (observerEnabled) {
    const outputLog = vscode.workspace
      .getConfiguration("openbox")
      .get<boolean>("tabObserver.outputLog", true);
    const observerActive = vscode.workspace
      .getConfiguration("openbox")
      .get<boolean>("tabObserver.active", false);
    const obs = createTabObserver({
      onChange: () => {
        /* no-op; active path handles enforcement, classifier handles telemetry */
      },
      suppressOutputChannel: !outputLog,
      active: observerActive,
      governance,
    });
    context.subscriptions.push({ dispose: () => obs.dispose() });
  }

  // Settings change. Rebuild the client when the user toggles the env
  // via the QuickPick command below (which writes the setting and lets
  // this listener react uniformly).
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("openbox.environment")) {
        const next = readEnv();
        if (next !== env) boot(next);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("openbox.approve", async (node: any) => {
      const approval: Approval | undefined = node?.approval ?? (node?.id ? node : undefined);
      if (!approval || !client) return;
      try {
        await client.decideApproval(approval.agent_id || "", approval.id, { action: "approve" });
        vscode.window.showInformationMessage(`Approved (${env})`);
        feed?.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Approve failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand("openbox.reject", async (node: any) => {
      const approval: Approval | undefined = node?.approval ?? (node?.id ? node : undefined);
      if (!approval || !client) return;
      try {
        await client.decideApproval(approval.agent_id || "", approval.id, { action: "reject" });
        vscode.window.showInformationMessage(`Rejected (${env})`);
        feed?.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Reject failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand("openbox.refresh", () => {
      feed?.refresh();
    }),

    vscode.commands.registerCommand("openbox.copyDetail", (value: string) => {
      vscode.env.clipboard.writeText(value);
    }),

    // QuickPick env switcher; writes the setting (Global scope), the
    // onDidChangeConfiguration handler above does the actual reboot.
    vscode.commands.registerCommand("openbox.switchEnvironment", async () => {
      const choice = await vscode.window.showQuickPick(
        [
          { label: "production", description: "https://api.openbox.ai" },
          { label: "staging", description: "internal; set OPENBOX_API_URL" },
          { label: "local", description: "http://localhost:3000" },
        ],
        { placeHolder: `Current: ${env}; pick the new environment` },
      );
      if (!choice) return;
      await vscode.workspace
        .getConfiguration("openbox")
        .update("environment", choice.label, vscode.ConfigurationTarget.Global);
    }),
  );

  context.subscriptions.push(treeProvider);
}

export function deactivate() {
  feed?.stop();
}
