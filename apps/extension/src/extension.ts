import * as vscode from "vscode";
import type { OpenBoxClient } from "openbox-sdk/client";
import type { EnvName } from "openbox-sdk/env";
import { createApiContext } from "./api";
import { ApprovalsPollingService as PollingService } from "openbox-sdk/polling";
import { ApprovalsTreeProvider } from "./approvalsView";
import { createTabObserver } from "./tabObserver";
import { PreWriteGate, extractTargetUri } from "./preWriteGate";
import { PreFileOpGate } from "./preFileOpGate";
import { GovernanceClient } from "./governanceClient";
import { resolveBoot, showUnconfiguredPrompt } from "./bootResolver";
import { MockApprovalsFeed } from "./mockFeed";
import { HookLogTail } from "./hookLogChannel";
import type { Approval } from "./types";

/** Backend's Halt verdict; approvals with this code block the save flow. */
const VERDICT_HALT = 4;

// In mock mode the feed is the MockApprovalsFeed; in real mode it's the
// network-driven PollingService. Both expose .stop() / .refresh() and
// emit 'changed' / 'newApprovals' / 'error', which is all the consumer
// uses.
type ApprovalsFeed = PollingService | MockApprovalsFeed;
let feed: ApprovalsFeed | undefined;

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
  let env: EnvName = resolveBoot().env;
  let client: OpenBoxClient | undefined;
  let orgId: string | undefined;
  /** Active boot view. Drives status-bar painting + the no-key prompt. */
  let lastView = resolveBoot();

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

  // Hook log channel. Tails ~/.openbox/log/cursor-hook.jsonl that the
  // `openbox cursor hook` subprocess writes per event. Surfaces hook
  // activity inside Cursor in real time so the user doesn't have to
  // tail extension-host logs.
  const hookLog = new HookLogTail();
  hookLog.start(context);

  // URIs that previously had a halt deny recorded, so we can call
  // clearDeny when the same approval transitions out of pending. Keyed
  // by approval ID; the value is the document URI we recorded against.
  const haltedApprovals = new Map<string, string>();

  function paintIdle(envTag: EnvName, count: number) {
    const cfg = vscode.workspace.getConfiguration('openbox');
    const tag = lastView.mode === 'mock' ? `MOCK · ${envTag}` : envTag;
    const anyActive =
      cfg.get<boolean>('preWriteGate.active', false) ||
      (cfg.get<boolean>('tabObserver.enabled', false) && cfg.get<boolean>('tabObserver.active', false)) ||
      cfg.get<boolean>('fileOpGate.enabled', false);
    const haveAgent = !!(lastView.agentId);
    const idleNote = anyActive && !haveAgent ? ' · gates idle (no agent)' : '';
    if (count > 0) {
      statusBar.text = `$(shield) ${count} Pending · ${tag}${idleNote}`;
    } else {
      statusBar.text = `$(shield) OpenBox · ${tag}${idleNote}`;
    }
    if (anyActive && !haveAgent) {
      statusBar.tooltip =
        'Active gates are turned on but `openbox.agentId` is empty, so check_governance is skipped. Set the agent ID in settings to enable enforcement.';
    }
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

  function wireFeed(f: ApprovalsFeed) {
    f.on("changed", (approvals: Approval[]) => {
      treeProvider.update(approvals);
      const count = approvals.length;
      paintIdle(env, count);
      treeView.badge = count > 0 ? { value: count, tooltip: `${count} pending approvals` } : undefined;
      vscode.commands.executeCommand("setContext", "openbox.hasApprovals", count > 0);

      // Halt-verdict gating: any pending approval at verdict 4 whose
      // target URI is currently open gets a recordDeny on the gate.
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
        const tag = lastView.mode === "mock" ? `[MOCK] ${agent}` : `[${env}] ${agent}`;

        vscode.window
          .showWarningMessage(`${tag}: ${reason}`, "Approve", "Reject", "View")
          .then((choice) => {
            if (choice === "Approve" || choice === "Reject") {
              void decideApproval(a, choice === "Approve" ? "approve" : "reject");
            } else if (choice === "View") {
              vscode.commands.executeCommand("openbox.approvals.focus");
            }
          });
      }
    });

    f.on("error", (err: Error) => {
      console.error(`OpenBox feed error (${env}):`, err.message);
    });
  }

  async function decideApproval(a: Approval, action: "approve" | "reject"): Promise<void> {
    if (lastView.mode === "mock" && feed instanceof MockApprovalsFeed) {
      await feed.decide(a.id);
      return;
    }
    if (!client) return;
    await client.decideApproval(a.agent_id || "", a.id, { action });
    feed?.refresh();
  }

  async function boot() {
    feed?.stop();
    feed = undefined;
    treeProvider.update([]);
    treeView.badge = undefined;
    vscode.commands.executeCommand("setContext", "openbox.hasApprovals", false);

    lastView = resolveBoot();
    env = lastView.env;
    statusBar.text = `$(sync~spin) OpenBox · ${env}`;
    statusBar.tooltip = `Connecting to ${env}…`;

    if (lastView.mode === "mock") {
      client = undefined;
      orgId = "mock-org-001";
      const mock = new MockApprovalsFeed();
      wireFeed(mock);
      mock.start();
      feed = mock;
      statusBar.tooltip = `Mock auth (no backend) · ${env}`;
      return;
    }

    if (lastView.mode === "unconfigured") {
      client = undefined;
      statusBar.text = `$(shield) OpenBox · ${env} · no key`;
      statusBar.tooltip = `No API key for any env. Click for setup options.`;
      // One-time prompt with actionable buttons; respects "Don't show again".
      void showUnconfiguredPrompt(context, env);
      return;
    }

    if (lastView.fellBackFrom) {
      // Surfaced silently in the status bar; no modal. The user picked
      // an env that has no key, so we fell back to one that does.
      console.log(
        `OpenBox: '${lastView.fellBackFrom}' has no API key; using '${env}' instead. Set openbox.environment to suppress.`,
      );
    }

    let ctx: { client: OpenBoxClient; apiBase: string };
    try {
      ctx = await createApiContext(env);
      client = ctx.client;
    } catch (err: any) {
      client = undefined;
      statusBar.text = `$(shield) OpenBox · ${env}: No Token`;
      statusBar.tooltip = err.message;
      void showUnconfiguredPrompt(context, env);
      return;
    }

    try {
      const profile: any = await client.getProfile();
      orgId = profile.orgId;
      if (!orgId) {
        statusBar.text = `$(shield) OpenBox · ${env}: No Org`;
        return;
      }
      const fbNote = lastView.fellBackFrom ? ` (fell back from '${lastView.fellBackFrom}')` : "";
      statusBar.tooltip = `Signed in as ${profile.email || profile.preferred_username || profile.sub} (${env})${fbNote}`;
    } catch (err: any) {
      statusBar.text = `$(shield) OpenBox · ${env}: Error`;
      statusBar.tooltip = err.message;
      return;
    }

    void ctx;
    const polling = new PollingService(client, orgId);
    wireFeed(polling);
    polling.start();
    feed = polling;
  }

  await boot();
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

  // Settings change. Rebuild the client (or feed) when the user
  // toggles env, mock auth, or agent_id; status bar repainted when
  // active-gate toggles flip so the silent-no-op tag stays in sync.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("openbox.environment") ||
        e.affectsConfiguration("openbox.mockAuth")
      ) {
        void boot();
        return;
      }
      if (
        e.affectsConfiguration("openbox.agentId") ||
        e.affectsConfiguration("openbox.preWriteGate.active") ||
        e.affectsConfiguration("openbox.tabObserver.active") ||
        e.affectsConfiguration("openbox.fileOpGate.enabled")
      ) {
        lastView = resolveBoot();
        paintIdle(env, feed?.approvals?.length ?? 0);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("openbox.approve", async (node: any) => {
      const approval: Approval | undefined = node?.approval ?? (node?.id ? node : undefined);
      if (!approval) return;
      try {
        await decideApproval(approval, "approve");
        vscode.window.showInformationMessage(
          lastView.mode === "mock" ? `Approved (MOCK)` : `Approved (${env})`,
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(`Approve failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand("openbox.reject", async (node: any) => {
      const approval: Approval | undefined = node?.approval ?? (node?.id ? node : undefined);
      if (!approval) return;
      try {
        await decideApproval(approval, "reject");
        vscode.window.showInformationMessage(
          lastView.mode === "mock" ? `Rejected (MOCK)` : `Rejected (${env})`,
        );
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

    // Diagnostic: runs governance.check() from the extension host
    // with the configured agent + env. Used by the live e2e suite
    // to confirm the gate's network path works without going
    // through the gate's own veto/save dance. Intentionally no
    // surface in the package.json contributions, so it stays
    // internal — only test code that knows the id can invoke it.
    vscode.commands.registerCommand(
      "openbox.__diag.checkGovernance",
      async (input: {
        spanType: "shell" | "file_write" | "file_read" | "http" | "db" | "mcp" | "llm";
        activityInput: Record<string, unknown>;
      }) => {
        try {
          const r = await governance.check({
            spanType: input.spanType,
            activityInput: input.activityInput,
          });
          return r;
        } catch (err: any) {
          return { outcome: "error", reason: String(err?.message ?? err) };
        }
      },
    ),

    // Diagnostic: returns the current pending-approvals count from
    // whatever feed is wired (mock or real). The e2e suites use
    // this to assert "approve removed a row" without DOM-walking
    // the tree (which is brittle across editor forks).
    vscode.commands.registerCommand("openbox.__diag.approvalsCount", () => {
      return feed?.approvals.length ?? 0;
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
