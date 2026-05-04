import * as vscode from "vscode";
import type { OpenBoxClient } from "openbox-sdk/client";
import type { EnvName } from "openbox-sdk/env";
import { createApi, createApiContext } from "./api";
import { ApprovalsPollingService as PollingService } from "openbox-sdk/polling";
import { ApprovalsTreeProvider } from "./approvalsView";
import { createTabObserver } from "./tabObserver";
import { PreWriteGate } from "./preWriteGate";
import type { Approval } from "./types";

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

  function paintIdle(envTag: EnvName, count: number) {
    statusBar.text =
      count > 0 ? `$(shield) ${count} Pending · ${envTag}` : `$(shield) OpenBox · ${envTag}`;
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
  // these surfaces, so we classify mutations heuristically and log to
  // an OutputChannel. Off by default; flipped on via the setting.
  const observerEnabled = vscode.workspace
    .getConfiguration("openbox")
    .get<boolean>("tabObserver.enabled", false);
  if (observerEnabled) {
    const obs = createTabObserver();
    context.subscriptions.push({ dispose: () => obs.dispose() });
  }

  // Pre-write gate. Empty pending map at boot; entries land when the
  // approvals feed reports a halt verdict for an open document.
  const preWrite = new PreWriteGate();
  preWrite.attach(context);
  context.subscriptions.push({ dispose: () => preWrite.dispose() });

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
