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
import { ENVIRONMENTS, DEFAULT_ENV, type EnvName } from "openbox-sdk/env";
import { resolveOsPath } from "openbox-sdk/os-paths";
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
import { writeGlobalEnv } from "./configStore";

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

const ENV_NAMES = new Set(Object.keys(ENVIRONMENTS));
function readEnv(): EnvName {
  const v = vscode.workspace.getConfiguration("openbox").get<string>("environment", DEFAULT_ENV);
  return ENV_NAMES.has(v) ? (v as EnvName) : DEFAULT_ENV;
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
  const profileTreeView = vscode.window.createTreeView("openbox.profile", {
    treeDataProvider: profileProvider,
  });
  context.subscriptions.push(profileTreeView);

  // Cursor 3.x sidebar2 cold-launch race: when the user has the
  // OpenBox container saved as the active sidebar at startup,
  // sidebar2's render effect runs *before* the
  // viewsExtensionHandler workbench contribution registers our
  // composite. It calls `compositeRegistry.getComposite("workbench.view.extension.openbox")`,
  // gets undefined, logs `no composite descriptor found for ...`,
  // and bails. The render effect is reactive on
  // `activeViewContainerID` but NOT on `compositeRegistry`
  // updates - so our composite gets registered moments later
  // but sidebar2 never re-runs, leaving the panel empty until
  // the user toggles to another container and back (which
  // changes `activeViewContainerID` and forces a re-run).
  //
  // Workaround: watch the profile TreeView's visibility for 1
  // second. If it never fires `onDidChangeVisibility(true)` we
  // hit the race; force a toggle to the explorer container and
  // back to trigger sidebar2's reactive re-run. By that time
  // our composite IS registered, so it renders correctly. The
  // toggle is a no-op for users on a different container - the
  // .visible check still fails for them, but they never had the
  // bug, and the brief flash to/from explorer is invisible.
  let visibilitySettled = false;
  const visibilitySub = profileTreeView.onDidChangeVisibility(() => {
    visibilitySettled = true;
  });
  context.subscriptions.push(visibilitySub);
  setTimeout(() => {
    if (visibilitySettled) return;
    void vscode.commands.executeCommand("workbench.view.explorer").then(
      () => vscode.commands.executeCommand("workbench.view.extension.openbox"),
      () => undefined,
    );
  }, 1000);

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

  // Sync the resolved env to ~/.openbox/config on every activation
  // so CLI / MCP / slash commands / any subprocess reading the file
  // sees the same env the editor is currently bound to. Single
  // source of truth: the config file. The vscode setting wins when
  // explicitly set; whatever wins gets written here.
  try {
    writeGlobalEnv(env);
  } catch {
    /* permissions / disk error - non-fatal. */
  }

  function paintIdle(envTag: EnvName, count: number) {
    const cfg = vscode.workspace.getConfiguration("openbox");
    // Env tag is debug-only context. Release builds keep the bar
    // clean so end users never see env names tagged on every
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
   *  for development visibility; release builds hide it so end
   *  users never see env names tagged on transient state. */
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
        // Sync the new env into ~/.openbox/config so CLI, MCP, slash
        // commands, and any subprocess that reads the file picks it
        // up too. Single source of truth: the config file.
        try {
          writeGlobalEnv(next);
        } catch {
          /* permissions / disk error - non-fatal; extension still
             boots, but CLI surfaces may stay on the old env until
             the user runs `openbox config set OPENBOX_ENV ...`. */
        }
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

  /** Stable registration for ViewSession-driven commands. Every
   *  title-bar button + command-palette filter / search entry
   *  routes through `active?.<scope>?.<method>()` if a session has
   *  booted, otherwise shows a "still booting" toast. The previous
   *  shape registered these inside ViewSession.constructor, which
   *  meant clicking a History title-bar button before the boot
   *  finished surfaced "command not found" to the user. */
  function notReady() {
    vscode.window.showInformationMessage(
      "OpenBox: still booting; wait for the sidebar to load and try again.",
    );
  }
  function registerScopedCommand<S extends "pending" | "history">(
    id: string,
    scope: S,
    method: keyof import("./viewSession").ViewSession,
  ): vscode.Disposable {
    return vscode.commands.registerCommand(id, () => {
      const session = scope === "pending" ? active?.pending : active?.history;
      if (!session) {
        notReady();
        return;
      }
      const m = (session as any)[method];
      if (typeof m === "function") m.call(session);
    });
  }

  context.subscriptions.push(
    // Pending view title-bar + palette commands.
    registerScopedCommand("openbox.search", "pending", "search"),
    registerScopedCommand("openbox.filter", "pending", "filter"),
    registerScopedCommand("openbox.filterTier", "pending", "filterTier"),
    registerScopedCommand("openbox.filterType", "pending", "filterType"),
    registerScopedCommand("openbox.filterTeam", "pending", "filterTeam"),
    registerScopedCommand("openbox.filterOwner", "pending", "filterOwner"),
    registerScopedCommand("openbox.toggleSort", "pending", "toggleSort"),
    registerScopedCommand("openbox.clearFilters", "pending", "clearFilters"),
    registerScopedCommand("openbox.loadMore", "pending", "loadMore"),
    // History view title-bar + palette commands.
    registerScopedCommand("openbox.history.refresh", "history", "refresh"),
    registerScopedCommand("openbox.history.search", "history", "search"),
    registerScopedCommand("openbox.history.filter", "history", "filter"),
    registerScopedCommand("openbox.history.filterTier", "history", "filterTier"),
    registerScopedCommand("openbox.history.filterType", "history", "filterType"),
    registerScopedCommand("openbox.history.filterTeam", "history", "filterTeam"),
    registerScopedCommand("openbox.history.filterOwner", "history", "filterOwner"),
    registerScopedCommand("openbox.history.toggleSort", "history", "toggleSort"),
    registerScopedCommand("openbox.history.clearFilters", "history", "clearFilters"),
    registerScopedCommand("openbox.history.setStatus", "history", "setStatus"),
    registerScopedCommand("openbox.history.setDateRange", "history", "setDateRange"),
    registerScopedCommand("openbox.history.loadMore", "history", "loadMore"),

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
      const p = resolveOsPath("tokens");
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

    // Diagnostic: bypass-modal decide. The user-facing openbox.reject
    // shows a confirmation modal; tests need a path that drives the
    // network call directly. Approve has no modal so it just delegates.
    vscode.commands.registerCommand(
      "openbox.__diag.decide",
      async (node: { id?: string; agent_id?: string } | undefined, action: "approve" | "reject") => {
        const id = node?.id;
        const agentId = node?.agent_id;
        if (!id || !active) return;
        try {
          await active.client.decideApproval(agentId ?? "", id, { action });
          active.pending.refresh();
          if (active.history) active.history.refresh();
        } catch {
          /* tests assert via approvalsCount; surface nothing here */
        }
      },
    ),

    // Diagnostic: history bucket count. Tests assert decided rows
    // land in the history view after decide.
    vscode.commands.registerCommand("openbox.__diag.historyCount", () => {
      return active?.history?.count ?? 0;
    }),

    // Diagnostic: snapshot of the active boot view. Tests assert
    // profile + auth + agent IDs reach the active session.
    vscode.commands.registerCommand("openbox.__diag.boot", () => {
      if (!active) return null;
      return {
        orgId: active.orgId,
        email: active.email,
        sub: active.sub,
        keyId: active.keyId,
        isApiKeyAuth: active.isApiKeyAuth,
        env,
        agentId: governance.agentId(),
        mockAuth: readMockAuth(),
      };
    }),

    // Diagnostic: needsKey context state. Onboard view fires off this.
    vscode.commands.registerCommand("openbox.__diag.needsKey", async () => {
      const ctxKeys = await vscode.commands.executeCommand<unknown>("getContext", "openbox.needsKey").catch(() => undefined);
      return ctxKeys === true;
    }),

    // Diagnostic: refresh + return new pending count. Used to assert
    // a decide round-trip moves a row out of pending.
    vscode.commands.registerCommand("openbox.__diag.refresh", async () => {
      if (!active) return 0;
      await active.pending.refresh();
      if (active.history) await active.history.refresh();
      return active.pending.count;
    }),
  );

  if (DEBUG_BUILD) {
    context.subscriptions.push(
      vscode.commands.registerCommand("openbox.switchEnvironment", async () => {
        // Pick list derived from the spec-emitted ENVIRONMENTS table
        // so a new env added in TypeSpec automatically appears here
        // without an extension edit.
        const choices = Object.keys(ENVIRONMENTS).map((label) => ({ label }));
        const choice = await vscode.window.showQuickPick(choices, {
          placeHolder: `Current: ${env}; pick the new environment`,
        });
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
