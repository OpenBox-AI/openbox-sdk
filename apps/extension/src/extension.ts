// OpenBox extension entry. Wires:
//
//   * Approvals UI surface - pending + history view sessions, detail
//     panel, onboard view, profile view, debug controls (dev builds).
//     Recovered from feat/approvals-shared-helpers; the rich surface
//     went orphan when work moved to feat/cursor-runtime.
//
//   * Active governance gates - PreWriteGate, PreFileOpGate,
//     TabObserver. Each independently consults the GovernanceClient,
//     which reads `openbox.agentId` + the runtime key from
//     ~/.openbox/agent-keys (or OPENBOX_API_KEY).
//
//   * Hook activity log - tails ~/.openbox/log/cursor-hook.jsonl into
//     a Cursor OutputChannel so the user sees every hook the
//     `openbox cursor hook` subprocess fires.
//
//   * Halt-verdict ↔ save coordination - when the approvals feed
//     reports a pending row at verdict 4 whose target URI is open,
//     PreWriteGate's recordDeny lights up so the next save reverts.

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { OpenBoxClient } from "openbox-sdk/client";
import type { EnvName } from "openbox-sdk/env";
import {
  apiKeyPrefix,
  clearApiKey,
  createApiContext,
  hasApiKey,
  readStore,
  validateApiKey,
  writeApiKey,
} from "./api";
import { ApprovalDetailPanel } from "./detailPanel";
import { ViewSession, inlineDecide } from "./viewSession";
import type { Approval, Member, Team } from "./types";
import { apiKeysUrl } from "./dashboardUrl";
import { showDebugInfoPanel, type DebugSnapshot } from "./debugInfoPanel";
import { MockClient } from "./mockClient";
import { mockStore } from "./mockStore";
import { DebugControlsProvider } from "./debugView";
import { ProfileProvider } from "./profileView";
import { OnboardProvider } from "./onboardView";
import { createTabObserver } from "./tabObserver";
import { PreWriteGate, extractTargetUri } from "./preWriteGate";
import { PreFileOpGate } from "./preFileOpGate";
import { GovernanceClient } from "./governanceClient";
import { HookLogTail } from "./hookLogChannel";

// Build-time flag, baked by esbuild via --define:process.env.OPENBOX_DEBUG_BUILD.
// `npm run build` (production) sets it to "false"; `npm run build:dev` sets
// "true". When false, all debug commands, the debug tree view, and mock-auth
// affordances stay unregistered, and esbuild dead-code-eliminates the
// branches below - so a prod .vsix can't be flipped into debug at runtime.
const DEBUG_BUILD = process.env.OPENBOX_DEBUG_BUILD === "true";

// Org API key shape; matches the CLI's auth.ts validator. Anything else
// is rejected before it touches the token store so we surface the
// problem at paste time rather than after a failed first request.
const API_KEY_PATTERN = /^obx_key_[0-9a-f]{48}$/;

/** Backend's Halt verdict; approvals with this code block the save flow. */
const VERDICT_HALT = 4;

interface ActiveBoot {
  pending: ViewSession;
  history: ViewSession;
  client: OpenBoxClient;
  orgId: string;
  email: string | undefined;
  sub: string | undefined;
  name: string | undefined;
  preferredUsername: string | undefined;
  emailVerified: boolean | undefined;
  keyId: string | undefined;
  apiKeyPermissions: string[] | undefined;
  isApiKeyAuth: boolean;
  activeKey: ActiveKeyInfo | undefined;
  activeKeyError: string | undefined;
}

interface ActiveKeyInfo {
  id: string;
  name: string;
  description?: string;
  permissions?: string[];
  valid_from?: string | null;
  expires_at?: string | null;
  ip_whitelist?: string[] | null;
  is_active?: boolean;
  created_at?: string;
  last_used_at?: string | null;
}

let active: ActiveBoot | undefined;

function readEnv(): EnvName {
  const v = vscode.workspace.getConfiguration("openbox").get<string>("environment", "production");
  return v === "staging" || v === "local" ? v : "production";
}

function readNotifyOnNew(): boolean {
  return vscode.workspace.getConfiguration("openbox").get<boolean>("notifyOnNewApprovals", true);
}

function readMockAuth(): boolean {
  // Mock auth is itself a debug-only feature in published builds. The
  // user-facing setting still toggles, but in DEBUG_BUILD=false the
  // surrounding code paths gate on this value, so flipping it on in
  // a prod .vsix is a no-op.
  return DEBUG_BUILD && vscode.workspace.getConfiguration("openbox").get<boolean>("mockAuth", false);
}

export async function activate(context: vscode.ExtensionContext) {
  // openbox.devMode used to gate dev-only commands on
  // ExtensionMode.Development; openbox.debug now drives the same
  // gate so end users can flip on the env selector + debug panel
  // without rebuilding.
  function paintDebugContext() {
    vscode.commands.executeCommand("setContext", "openbox.debug", DEBUG_BUILD);
    vscode.commands.executeCommand("setContext", "openbox.mockAuth", readMockAuth());
    vscode.commands.executeCommand(
      "setContext",
      "openbox.devMode",
      context.extensionMode === vscode.ExtensionMode.Development,
    );
  }
  paintDebugContext();

  // Auto-open walkthrough on first activation. Subsequent activations
  // skip; the user can always re-open via "OpenBox: Open Getting
  // Started" from the palette. globalState survives across reloads.
  if (!context.globalState.get<boolean>("openbox.walkthroughShown")) {
    vscode.commands.executeCommand(
      "workbench.action.openWalkthrough",
      { category: "OpenBox.openbox#openbox.gettingStarted" },
      false,
    );
    void context.globalState.update("openbox.walkthroughShown", true);
  }

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = "openbox.approvals.focus";
  statusBar.show();
  context.subscriptions.push(statusBar);

  // Onboard view - single gated welcome page when no API key is set.
  // Pending / History / Profile are all hidden in that state so the
  // user lands on one clear "Set API Key" page instead of three
  // half-empty views all repeating the same prompt.
  context.subscriptions.push(
    vscode.window.createTreeView("openbox.onboard", { treeDataProvider: new OnboardProvider() }),
  );

  // Profile view - present whenever an API key is set, regardless of
  // build flavor. Holds the user-facing identity rows and the
  // Sign Out / Change Key toolbar buttons.
  const profileProvider = new ProfileProvider(() => buildDebugSnapshot());
  context.subscriptions.push(
    vscode.window.createTreeView("openbox.profile", { treeDataProvider: profileProvider }),
  );

  // Debug controls only get registered in dev builds.
  let debugProvider: DebugControlsProvider | undefined;
  if (DEBUG_BUILD) {
    debugProvider = new DebugControlsProvider(() => buildDebugSnapshot());
    context.subscriptions.push(
      debugProvider,
      vscode.window.createTreeView("openbox.debugControls", { treeDataProvider: debugProvider }),
    );
  }

  // Governance client (workspace-config-driven; reads agent_id, env).
  // Shared across PreWriteGate, TabObserver, PreFileOpGate so they
  // resolve `openbox.agentId` consistently.
  const governance = new GovernanceClient();

  // Pre-write gate. Constructed up front so the polling-changed
  // handler can record/clear halt verdicts on it. Active mode
  // (per-save check_governance) is gated by openbox.preWriteGate.active
  // inside handleSave.
  const preWrite = new PreWriteGate(governance);
  preWrite.attach(context);
  context.subscriptions.push({ dispose: () => preWrite.dispose() });

  // File-operation gate (create / delete / rename). Gated by
  // openbox.fileOpGate.enabled at call time so toggling the setting
  // doesn't require a reload.
  const fileOpGate = new PreFileOpGate(governance);
  fileOpGate.attach(context);
  context.subscriptions.push({ dispose: () => fileOpGate.dispose() });

  // Hook log channel. Tails ~/.openbox/log/cursor-hook.jsonl that
  // `openbox cursor hook` writes per event. Surfaces hook activity
  // inside Cursor in real time.
  const hookLog = new HookLogTail();
  hookLog.start(context);

  // Tab / Composer / Cmd-K observer. Cursor doesn't expose hooks for
  // these surfaces, so we classify mutations heuristically. With
  // openbox.tabObserver.active, classified non-keystroke inserts also
  // call check_governance and revert on deny.
  const observerEnabled = vscode.workspace
    .getConfiguration("openbox")
    .get<boolean>("tabObserver.enabled", false);
  if (observerEnabled) {
    const obsCfg = vscode.workspace.getConfiguration("openbox");
    const outputLog = obsCfg.get<boolean>("tabObserver.outputLog", true);
    const observerActive = obsCfg.get<boolean>("tabObserver.active", false);
    const emitAgentTrace = obsCfg.get<boolean>("tabObserver.emitAgentTrace", false);
    const obs = createTabObserver({
      onChange: () => {
        /* no-op; active path handles enforcement, classifier handles telemetry */
      },
      suppressOutputChannel: !outputLog,
      active: observerActive,
      emitAgentTrace,
      governance,
    });
    context.subscriptions.push({ dispose: () => obs.dispose() });
  }

  // URIs that previously had a halt deny recorded, so we can call
  // clearDeny when the same approval transitions out of pending.
  const haltedApprovals = new Map<string, string>();

  let env: EnvName = readEnv();

  function paintIdle(envTag: EnvName, count: number) {
    const cfg = vscode.workspace.getConfiguration("openbox");
    // Env tag is debug-only context. Production builds keep the bar
    // clean so end users don't see "production" tacked onto every
    // status bar refresh.
    const showEnv = DEBUG_BUILD || readMockAuth();
    const envSuffix = readMockAuth()
      ? ` · MOCK · ${envTag}`
      : showEnv
        ? ` · ${envTag}`
        : "";
    const anyActive =
      cfg.get<boolean>("preWriteGate.active", false) ||
      (cfg.get<boolean>("tabObserver.enabled", false) && cfg.get<boolean>("tabObserver.active", false)) ||
      cfg.get<boolean>("fileOpGate.enabled", false);
    const haveAgent = !!cfg.get<string>("agentId", "").trim();
    const idleNote = anyActive && !haveAgent ? " · gates idle (no agent)" : "";
    if (count > 0) {
      statusBar.text = `$(shield) ${count} Pending${envSuffix}${idleNote}`;
    } else {
      statusBar.text = `$(shield) OpenBox${envSuffix}${idleNote}`;
    }
    if (anyActive && !haveAgent) {
      statusBar.tooltip =
        "Active gates are turned on but `openbox.agentId` is empty, so check_governance is skipped. Set the agent ID in settings to enable enforcement.";
    }
  }

  /** Build the boot / error tag. Debug builds carry the env suffix
   *  ("OpenBox · staging: Error"); production hides the env so end
   *  users don't see "production" tagged on every transient state. */
  function envTagFor(state: string): string {
    return DEBUG_BUILD ? `OpenBox · ${env}: ${state}` : `OpenBox: ${state}`;
  }

  /** True when `uri` is currently open in any editor tab. */
  function isUriOpen(uri: string): boolean {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input as { uri?: vscode.Uri } | undefined;
        if (input?.uri && input.uri.toString() === uri) return true;
      }
    }
    return false;
  }

  /** Merge the halt-verdict tracking with the fresh approval set. */
  function syncHaltedApprovals(approvals: Approval[]) {
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
  }

  async function boot(nextEnv: EnvName) {
    // Wipe everything tied to the previous boot before we start the
    // next one. Prevents a stale detail panel from sitting on top of
    // a sign-out / env-switch and the Profile tree from showing a
    // previous identity until the new poll lands.
    if (active) {
      active.pending.dispose();
      active.history.dispose();
      active = undefined;
    }
    ApprovalDetailPanel.disposeCurrent();
    profileProvider.refresh();

    env = nextEnv;
    statusBar.text = DEBUG_BUILD
      ? `$(sync~spin) OpenBox · ${env}`
      : `$(sync~spin) OpenBox`;
    statusBar.tooltip = DEBUG_BUILD ? `Connecting to ${env}…` : "Connecting…";
    vscode.commands.executeCommand("setContext", "openbox.hasApprovals", false);
    vscode.commands.executeCommand("setContext", "openbox.history.hasApprovals", false);

    const mockAuth = readMockAuth();
    if (!mockAuth && !hasApiKey(env)) {
      vscode.commands.executeCommand("setContext", "openbox.needsKey", true);
      statusBar.text = `$(key) ${envTagFor("Set API Key")}`;
      statusBar.tooltip = DEBUG_BUILD
        ? `No API key set for ${env}. Click the OpenBox view and use "Set API Key".`
        : `No API key set. Click the OpenBox view and use "Set API Key".`;
      statusBar.command = "openbox.setApiKey";
      return;
    }
    vscode.commands.executeCommand("setContext", "openbox.needsKey", false);
    statusBar.command = "openbox.approvals.focus";

    let client: OpenBoxClient;
    if (mockAuth) {
      // MockClient duck-types the methods PollingService + others use;
      // the cast keeps downstream typing consistent without polluting
      // every call site with a union type.
      client = new MockClient() as unknown as OpenBoxClient;
    } else {
      try {
        const ctx = await createApiContext(env);
        client = ctx.client;
      } catch (err: any) {
        statusBar.text = `$(shield) ${envTagFor("No Token")}`;
        statusBar.tooltip = err.message;
        vscode.window.showErrorMessage(`OpenBox: ${err.message}`);
        return;
      }
    }

    let orgId: string | undefined;
    let userSub: string | undefined;
    let email: string | undefined;
    let name: string | undefined;
    let preferredUsername: string | undefined;
    let emailVerified: boolean | undefined;
    let keyId: string | undefined;
    let apiKeyPermissions: string[] | undefined;
    let isApiKeyAuth = false;
    try {
      const profile: any = await client.getProfile();
      orgId = profile.orgId;
      userSub = profile.sub;
      email = profile.email;
      name = profile.name;
      preferredUsername = profile.preferred_username;
      emailVerified = profile.email_verified;
      isApiKeyAuth = profile.isApiKeyAuth === true;
      if (isApiKeyAuth) {
        if (typeof userSub === "string" && userSub.startsWith("api-key:")) {
          keyId = userSub.slice("api-key:".length);
        }
        if (Array.isArray(profile.permissions)) {
          apiKeyPermissions = profile.permissions as string[];
        }
      }

      if (!orgId) {
        try {
          const agents: any = await client.listAgents();
          orgId = agents?.data?.[0]?.organization_id;
        } catch {
          /* silent */
        }
      }

      if (!orgId) {
        statusBar.text = `$(shield) ${envTagFor("No Org")}`;
        return;
      }
      const tag = mockAuth ? "mock" : env;
      statusBar.tooltip = `Signed in as ${email || preferredUsername || userSub} (${tag})`;
    } catch (err: any) {
      statusBar.text = `$(shield) ${envTagFor("Error")}`;
      statusBar.tooltip = err.message;
      return;
    }

    let activeKey: ActiveKeyInfo | undefined;
    let activeKeyError: string | undefined;
    if (!mockAuth) {
      try {
        const res: any = await client.listApiKeys({ perPage: 100 });
        const keys: any[] = res?.data ?? [];
        if (keys.length === 0) {
          activeKeyError = "no keys returned";
        } else {
          const sorted = [...keys].sort((a, b) => {
            const ta = a.last_used_at ? Date.parse(a.last_used_at) : 0;
            const tb = b.last_used_at ? Date.parse(b.last_used_at) : 0;
            return tb - ta;
          });
          const top = sorted[0];
          activeKey = {
            id: top.id,
            name: top.name,
            description: top.description,
            permissions: top.permissions,
            valid_from: top.valid_from,
            expires_at: top.expires_at,
            ip_whitelist: top.ip_whitelist,
            is_active: top.is_active,
            created_at: top.created_at,
            last_used_at: top.last_used_at,
          };
        }
      } catch (err: any) {
        const status = typeof err?.status === "number" ? err.status : undefined;
        activeKeyError =
          status === 401
            ? "JWT-only endpoint"
            : status === 403
              ? "needs read:api_key"
              : err?.message ?? "error";
      }
    } else {
      activeKeyError = "mock auth";
    }

    let teams: Team[] = [];
    let members: Member[] = [];
    void (async () => {
      try {
        const res = (await client.listTeams(orgId!)) as { data?: Team[] };
        teams = res?.data ?? [];
      } catch {
        /* silent */
      }
    })();
    void (async () => {
      try {
        const res = (await client.listMembers(orgId!, { perPage: 200 })) as {
          members?: Member[];
          data?: Member[] | { members?: Member[] };
        };
        members =
          (Array.isArray(res?.members) && res.members) ||
          (Array.isArray(res?.data) && res.data) ||
          (res?.data && !Array.isArray(res.data) && Array.isArray(res.data.members) ? res.data.members : []) ||
          [];
      } catch {
        /* silent */
      }
    })();

    const agentOwnerCache = new Map<string, string | undefined>();
    const resolveAgentOwners = async (ids: string[]) => {
      const missing = ids.filter((id) => !agentOwnerCache.has(id));
      await Promise.all(
        missing.map(async (id) => {
          try {
            const res = (await client.getAgent(id)) as any;
            agentOwnerCache.set(id, res?.owner_id as string | undefined);
          } catch {
            agentOwnerCache.set(id, undefined);
          }
        }),
      );
    };

    paintIdle(env, 0);

    const refreshActive = () => {
      active?.pending.refresh();
      active?.history.refresh();
    };

    const sessionDeps = {
      context,
      client,
      orgId: orgId!,
      env,
      userSub,
      teams: () => teams,
      members: () => members,
      agentOwnerLookup: (id: string) => agentOwnerCache.get(id),
      resolveAgentOwners,
      onPendingCount: (count: number) => paintIdle(env, count),
      onError: (where: string, err: Error) =>
        console.error(`OpenBox ${where} feed error (${env}):`, err.message),
    };

    const pending = new ViewSession(
      {
        viewId: "openbox.approvals",
        scope: "pending",
        cmdNs: "openbox",
        ctxPrefix: "openbox",
        initialStatus: "pending",
        supportsStatus: false,
      },
      {
        ...sessionDeps,
        notifyOnNew: readNotifyOnNew(),
        onNewApproval: (a, e) => void inlineDecide(a, e, client, orgId!, context, refreshActive),
        onNewBatch: (count, e) => void notifyBatch(count, e),
        onApprovalsRefreshed: syncHaltedApprovals,
      },
    );

    const history = new ViewSession(
      {
        viewId: "openbox.history",
        scope: "history",
        cmdNs: "openbox.history",
        ctxPrefix: "openbox.history",
        // Slower cadence; mobile uses 30s for history because decided
        // rows don't move and the user isn't waiting on triage.
        pollMs: 30_000,
        supportsStatus: true,
        groupByStatus: true,
      },
      {
        ...sessionDeps,
        notifyOnNew: false,
        onNewApproval: () => {},
        onNewBatch: () => {},
      },
    );

    active = {
      pending,
      history,
      client,
      orgId: orgId!,
      email,
      sub: userSub,
      name,
      preferredUsername,
      emailVerified,
      keyId,
      apiKeyPermissions,
      isApiKeyAuth,
      activeKey,
      activeKeyError,
    };
    profileProvider.refresh();
    debugProvider?.refresh();
  }

  function notifyBatch(count: number, envTag: string) {
    vscode.window
      .showInformationMessage(`[${envTag}] ${count} new approvals pending`, "View")
      .then((choice) => {
        if (choice === "View") vscode.commands.executeCommand("openbox.approvals.focus");
      });
  }

  await boot(env);
  context.subscriptions.push({
    dispose: () => {
      if (active) {
        active.pending.dispose();
        active.history.dispose();
        active = undefined;
      }
    },
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("openbox.environment")) {
        const next = readEnv();
        if (next !== env) {
          void boot(next);
        }
        debugProvider?.refresh();
        profileProvider.refresh();
      }
      // Mock toggle reboots from scratch.
      if (e.affectsConfiguration("openbox.mockAuth")) {
        paintDebugContext();
        debugProvider?.refresh();
        profileProvider.refresh();
        if (DEBUG_BUILD) void boot(env);
      }
      // Gate-toggle / agentId changes only repaint the idle status -
      // no polling restart needed.
      if (
        e.affectsConfiguration("openbox.agentId") ||
        e.affectsConfiguration("openbox.preWriteGate.active") ||
        e.affectsConfiguration("openbox.tabObserver.active") ||
        e.affectsConfiguration("openbox.fileOpGate.enabled")
      ) {
        paintIdle(env, active?.pending.count ?? 0);
      }
    }),
  );

  /** Resolve an Approval from the variety of shapes call sites pass:
   *
   *   - Tree node: `{ approval: Approval, ... }` (sidebar context-menu)
   *   - Plain Approval: `{ id, agent_id, ... }` (history-item action)
   *   - Bare id string: `"apr_xxx"` (preWriteGate's "Open in OpenBox"
   *     modal button passes only the approvalId; lookup falls back to
   *     pending → history → undefined). */
  const pickApproval = (node: any): Approval | undefined => {
    if (!node) return undefined;
    if (typeof node === "string") {
      return (
        active?.pending.approvals.find((a) => a.id === node) ??
        active?.history.approvals.find((a) => a.id === node)
      );
    }
    if (node.approval) return node.approval as Approval;
    if (node.id) return node as Approval;
    return undefined;
  };

  function describeKeySource(envTag: EnvName): string {
    const url = apiKeysUrl(envTag);
    return url
      ? `Create a key in the dashboard: ${url}`
      : `Create a key in the dashboard under Organization → API Keys.`;
  }

  // Snapshot builder for the debug panel and the sidebar Debug view.
  // Function declaration (not const arrow) so it's hoisted.
  // eslint-disable-next-line no-inner-declarations
  function buildDebugSnapshot(): DebugSnapshot {
    const pendingErr = active?.pending.errorCount ?? 0;
    const historyErr = active?.history.errorCount ?? 0;
    const lastPendingPoll = active?.pending.lastPollAt;
    const lastHistoryPoll = active?.history.lastPollAt;
    const lastPoll = Math.max(lastPendingPoll || 0, lastHistoryPoll || 0) || undefined;
    const lastPendingErr = active?.pending.lastErrorAt;
    const lastHistoryErr = active?.history.lastErrorAt;
    const lastErrorAt = Math.max(lastPendingErr || 0, lastHistoryErr || 0) || undefined;
    const lastErrorMessage =
      (lastPendingErr || 0) > (lastHistoryErr || 0)
        ? active?.pending.lastErrorMessage
        : active?.history.lastErrorMessage;
    const tokenEntry = readStore()[env];
    return {
      env,
      sub: active?.sub,
      email: active?.email,
      name: active?.name,
      preferredUsername: active?.preferredUsername,
      emailVerified: active?.emailVerified,
      orgId: active?.orgId,
      hasApiKey: hasApiKey(env),
      keyPrefix: apiKeyPrefix(env),
      keyId: active?.keyId,
      apiKeyPermissions: active?.apiKeyPermissions,
      isApiKeyAuth: active?.isApiKeyAuth ?? false,
      keyUpdatedAt: tokenEntry?.updatedAt,
      permissions: tokenEntry?.permissions,
      features: tokenEntry?.features,
      activeKey: active?.activeKey,
      activeKeyError: active?.activeKeyError,
      pendingCount: active?.pending.count ?? 0,
      historyCount: active?.history.count ?? 0,
      lastPollAt: lastPoll,
      lastErrorAt,
      lastErrorMessage,
      errorCount: pendingErr + historyErr,
    };
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("openbox.approve", async (node: any) => {
      const approval = pickApproval(node);
      if (!approval || !active) return;
      try {
        await active.client.decideApproval(approval.agent_id || "", approval.id, { action: "approve" });
        vscode.window.showInformationMessage(`Approved (${env})`);
        active.pending.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Approve failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand("openbox.reject", async (node: any) => {
      const approval = pickApproval(node);
      if (!approval || !active) return;
      const choice = await vscode.window.showWarningMessage(
        `Reject ${approval.agent?.agent_name || "this approval"}?`,
        { modal: true, detail: "This will block the action." },
        "Reject",
      );
      if (choice !== "Reject") return;
      try {
        await active.client.decideApproval(approval.agent_id || "", approval.id, { action: "reject" });
        vscode.window.showInformationMessage(`Rejected (${env})`);
        active.pending.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Reject failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand("openbox.refresh", () => {
      active?.pending.refresh();
      active?.history.refresh();
    }),

    vscode.commands.registerCommand("openbox.copyDetail", (value: string) => {
      vscode.env.clipboard.writeText(value);
    }),

    vscode.commands.registerCommand("openbox.openDetail", (node: any) => {
      if (!active) {
        vscode.window.showInformationMessage(
          "OpenBox: still booting; wait for the sidebar to load and try again.",
        );
        return;
      }
      const approval = pickApproval(node);
      if (!approval) {
        vscode.window.showInformationMessage(
          typeof node === "string"
            ? `OpenBox: approval ${node} is not in the current pending or history view.`
            : "OpenBox: no approval row selected.",
        );
        return;
      }
      ApprovalDetailPanel.show(approval, context, {
        client: active.client,
        orgId: active.orgId,
        env,
        onDecided: () => {
          active?.pending.refresh();
          active?.history.refresh();
        },
      });
    }),

    vscode.commands.registerCommand("openbox.setApiKey", async () => {
      const value = await vscode.window.showInputBox({
        title: `OpenBox: Set API Key (${env})`,
        prompt: describeKeySource(env),
        placeHolder: "obx_key_…",
        password: true,
        ignoreFocusOut: true,
        validateInput: (v) => {
          const t = v.trim();
          if (!t) return "Key is required";
          if (!API_KEY_PATTERN.test(t)) return "Expected obx_key_<48 hex>.";
          return undefined;
        },
      });
      if (!value) return;
      const trimmed = value.trim();
      if (!validateApiKey(trimmed)) {
        vscode.window.showErrorMessage("Invalid API key shape (expected obx_key_<48 hex>).");
        return;
      }

      // Round-trip /auth/profile to confirm the key works before
      // persisting. Progress notification gives the user feedback
      // during the network call.
      const ok = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `OpenBox: validating ${env} API key…`,
          cancellable: false,
        },
        async () => {
          try {
            // Stage the key on disk first so createApiContext picks
            // it up; rollback below if /auth/profile rejects.
            writeApiKey(env, trimmed);
            const ctx = await createApiContext(env);
            const profile: any = await ctx.client.getProfile();
            return {
              ok: true as const,
              profile,
            };
          } catch (err: any) {
            // Rollback: drop the key we just staged so a bad paste
            // doesn't poison the next boot.
            try {
              clearApiKey(env);
            } catch {
              /* silent */
            }
            return { ok: false as const, message: String(err?.message ?? err) };
          }
        },
      );

      if (!ok.ok) {
        const choice = await vscode.window.showErrorMessage(
          `API key validation failed: ${ok.message}`,
          "Try Again",
        );
        if (choice === "Try Again") {
          vscode.commands.executeCommand("openbox.setApiKey");
        }
        return;
      }
      const who =
        ok.profile.email || ok.profile.preferred_username || ok.profile.sub || "unknown user";
      vscode.window.showInformationMessage(
        `API key saved. Signed in as ${who} (${ok.profile.orgId ?? "no org"}).`,
      );
      void boot(env);
    }),

    vscode.commands.registerCommand("openbox.openDashboard", async () => {
      const url = apiKeysUrl(env);
      if (!url) {
        vscode.window.showInformationMessage(`No dashboard URL configured for ${env}.`);
        return;
      }
      vscode.env.openExternal(vscode.Uri.parse(url));
    }),

    vscode.commands.registerCommand("openbox.clearCredentials", async () => {
      const choice = await vscode.window.showWarningMessage(
        "Clear all OpenBox API keys?",
        {
          modal: true,
          detail:
            "This deletes ~/.openbox/tokens, removing keys for all environments. You'll need to set them again.",
        },
        "Clear",
      );
      if (choice !== "Clear") return;
      const p = path.join(os.homedir(), ".openbox", "tokens");
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
        vscode.window.showInformationMessage("Cleared OpenBox credentials.");
        void boot(env);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to clear credentials: ${err.message}`);
      }
    }),

    // Per-env sign-out. Mirrors mobile's signOut button; clears just
    // the active env's slot in the token store, leaves other envs
    // alone. Distinct from clearCredentials which wipes everything.
    vscode.commands.registerCommand("openbox.signOut", async () => {
      const choice = await vscode.window.showWarningMessage(
        `Sign out of ${env}?`,
        {
          modal: true,
          detail: `This removes the API key for ${env}. Other environments are unaffected.`,
        },
        "Sign Out",
      );
      if (choice !== "Sign Out") return;
      try {
        clearApiKey(env);
        const cfg = vscode.workspace.getConfiguration("openbox");
        if (cfg.get<boolean>("mockAuth", false)) {
          await cfg.update("mockAuth", false, vscode.ConfigurationTarget.Global);
        } else {
          void boot(env);
        }
        vscode.window.showInformationMessage(`Signed out of ${env}.`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Sign out failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand("openbox.reboot", () => void boot(env)),

    vscode.commands.registerCommand("openbox.openWalkthrough", () => {
      vscode.commands.executeCommand(
        "workbench.action.openWalkthrough",
        "OpenBox.openbox#openbox.gettingStarted",
        false,
      );
    }),

    // Diagnostic: governance.check from the extension host with the
    // configured agent + env. Used by the live e2e suite.
    vscode.commands.registerCommand(
      "openbox.__diag.checkGovernance",
      async (input: {
        spanType: "shell" | "file_write" | "file_read" | "http" | "db" | "mcp" | "llm";
        activityInput: Record<string, unknown>;
      }) => {
        try {
          return await governance.check({
            spanType: input.spanType,
            activityInput: input.activityInput,
          });
        } catch (err: any) {
          return { outcome: "error", reason: String(err?.message ?? err) };
        }
      },
    ),

    // Diagnostic: pending-approvals count.
    vscode.commands.registerCommand("openbox.__diag.approvalsCount", () => {
      return active?.pending.count ?? 0;
    }),
  );

  if (DEBUG_BUILD) {
    context.subscriptions.push(
      vscode.commands.registerCommand("openbox.switchEnvironment", async () => {
        const choice = await vscode.window.showQuickPick(
          [{ label: "production" }, { label: "staging" }, { label: "local" }],
          { placeHolder: `Current: ${env}; pick the new environment` },
        );
        if (!choice) return;
        await vscode.workspace
          .getConfiguration("openbox")
          .update("environment", choice.label, vscode.ConfigurationTarget.Global);
      }),

      vscode.commands.registerCommand("openbox.showDebugInfo", () => {
        showDebugInfoPanel(context, buildDebugSnapshot);
      }),

      vscode.commands.registerCommand("openbox.toggleMockAuth", async () => {
        const cfg = vscode.workspace.getConfiguration("openbox");
        const next = !cfg.get<boolean>("mockAuth", false);
        await cfg.update("mockAuth", next, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Mock auth ${next ? "enabled" : "disabled"}.`);
      }),

      vscode.commands.registerCommand("openbox.seedMockData", () => {
        mockStore().seed(3);
        active?.pending.refresh();
        active?.history.refresh();
        const c = mockStore().counts();
        vscode.window.showInformationMessage(
          `Seeded 3 mock approvals. Now ${c.pending} pending, ${c.approved + c.rejected + c.expired} decided.`,
        );
      }),

      vscode.commands.registerCommand("openbox.resetMockData", () => {
        mockStore().reset();
        active?.pending.refresh();
        active?.history.refresh();
        const c = mockStore().counts();
        vscode.window.showInformationMessage(
          `Mock data reset. ${c.pending} pending, ${c.approved} approved, ${c.rejected} rejected, ${c.expired} expired.`,
        );
      }),
    );
  }
}

export function deactivate() {
  if (active) {
    active.pending.dispose();
    active.history.dispose();
    active = undefined;
  }
}
