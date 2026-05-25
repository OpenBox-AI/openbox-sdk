// OpenBox extension entry. Wires:
//
//   * Approvals UI surface - pending + history view sessions, detail
//     panel, onboard view, profile view, debug controls (dev builds).
//     Recovered from feat/approvals-shared-helpers; the rich surface
//     went orphan when work moved to feat/cursor-runtime.
//
//   * Active governance gates - PreWriteGate, PreFileOpGate,
//     TabObserver. Each independently consults the GovernanceClient.
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
import { ViewSession } from "./viewSession";
import type { Approval, Member, Team } from "./types";
import { apiKeysUrl } from "./dashboardUrl";
import { showDebugInfoPanel, type DebugSnapshot } from "./debugInfoPanel";
import { DebugControlsProvider } from "./debugView";
import { ProfileProvider } from "./profileView";
import { OnboardProvider } from "./onboardView";
import { createTabObserver } from "./tabObserver";
import { PreWriteGate, extractTargetUri } from "./preWriteGate";
import { PreFileOpGate } from "./preFileOpGate";
import { GovernanceClient } from "./governanceClient";
import { HookLogTail } from "./hookLogChannel";
import { ApprovalStore, type ApprovalState } from "./approvalStore";
import { ApprovalSocketServer } from "./approvalSocketServer";
import { startApprovalToastView } from "./approvalToastView";
import { buildIdleStatusBar, statusTagFor as statusTagForPure } from "./statusBarText";
import { pickApproval as pickApprovalPure } from "./pickApproval";
import { resolveApproval, type ResolvedApprovalEvent } from "./resolveApproval";

// Build-time flag, baked by esbuild via --define:process.env.OPENBOX_DEBUG_BUILD.
// `npm run build` (production) sets it to "false"; `npm run build:dev` sets
// "true". When false, all debug commands, the debug tree view, and mock-auth
// affordances stay unregistered, and esbuild dead-code-eliminates the
// branches below - so a prod .vsix can't be flipped into debug at runtime.
const DEBUG_BUILD = process.env.OPENBOX_DEBUG_BUILD === "true";

// OpenBox key shape; matches the CLI's auth.ts validator. Anything else
// is rejected before it touches the token store so we surface the
// problem at paste time rather than after a failed first request.
const API_KEY_PATTERN = /^obx_key_[0-9a-f]{48}$/;

/** Halt verdict; approvals with this code block the save flow. */
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

function connectionErrorMessage(err: unknown): string {
  const msg = typeof err === "string" ? err : (err as any)?.message ?? String(err);
  if (/401|unauthorized|invalid api key|missing authorization/i.test(msg)) {
    return "OpenBox connection could not be verified. Check the OpenBox key for this workspace.";
  }
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|getaddrinfo/i.test(msg)) {
    return "Cannot reach OpenBox. Check your network connection; the extension will reconnect automatically.";
  }
  if (/No X-API-Key|No API key|not connected/i.test(msg)) {
    return "OpenBox is not connected. Add the OpenBox key provided by your organization.";
  }
  return "OpenBox connection failed.";
}

function readNotifyOnNew(): boolean {
  return vscode.workspace.getConfiguration("openbox").get<boolean>("notifyOnNewApprovals", true);
}

function resolveApprovalSocketPath(): string | undefined {
  const configured = process.env.OPENBOX_APPROVAL_SOCKET?.trim();
  if (configured) return configured;
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const configPath = path.join(folder.uri.fsPath, ".cursor-hooks", "config.json");
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
      const socketPath = typeof parsed.OPENBOX_APPROVAL_SOCKET === "string"
        ? parsed.OPENBOX_APPROVAL_SOCKET.trim()
        : "";
      if (socketPath) return socketPath;
    } catch {
      /* no workspace-scoped socket config */
    }
  }
  return undefined;
}

export async function activate(context: vscode.ExtensionContext) {
  // openbox.debug drives the dev-only command gate (debug panel) so users can
  // flip these on at runtime without having to install a debug build.
  function paintDebugContext() {
    vscode.commands.executeCommand("setContext", "openbox.debug", DEBUG_BUILD);
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

  // Single source of truth for pending approvals. Two ingest sources
  // (socket from hook subprocesses + dashboard polling for everything
  // else) both upsert into one Map. Three view sinks (toast, panel,
  // status bar pulse) subscribe and re-render off store snapshots.
  const approvalStore = new ApprovalStore();
  const agentNameCache = new Map<string, string | undefined>();
  const historyDecisionOverlay = new Map<string, Approval>();
  context.subscriptions.push(approvalStore);

  // Socket server: hook subprocesses connect on require_approval and
  // push pending notifications. Decisions made via the toast push
  // back over the same connection so the hook's pollApproval race
  // resolves immediately (sub-millisecond round-trip).
  const approvalSocket = new ApprovalSocketServer(approvalStore, undefined, resolveApprovalSocketPath());
  approvalSocket.start();
  context.subscriptions.push(approvalSocket);

  context.subscriptions.push(
    approvalStore.onChange(() => {
      const pendingStates = approvalStore.pending();
      void hydratePendingAgentNames(pendingStates);
      const overlay = pendingStates.map(approvalStateToApproval);
      active?.pending.setOverlayApprovals?.(overlay);
      const count = overlay.length;
      // Socket-origin approvals can arrive before or between backend
      // polling ticks. Drive the Pending view context directly from
      // the store so the welcome/empty copy cannot stay visible while
      // the status bar already says "1 Pending".
      vscode.commands.executeCommand("setContext", "openbox.loading", false);
      vscode.commands.executeCommand("setContext", "openbox.hasApprovals", count > 0);
      paintIdle(count);
    }),
  );

  // Toast view subscribes to the store and renders one notification
  // per pending entry. Single notification path; dedup happens at
  // the store layer keyed by governance_event_id.
  context.subscriptions.push(
    startApprovalToastView({
      store: approvalStore,
      getClient: () => active?.client,
      onResolved: async (event) => {
        applyResolvedApprovalToViews(event);
        await active?.pending.refresh();
        await active?.history.refresh();
      },
      statusBar,
    }),
  );

  // Periodic reaper for expired entries. Fires every 5s; cheap.
  const reapTimer = setInterval(() => approvalStore.reapExpired(), 5_000);
  context.subscriptions.push({ dispose: () => clearInterval(reapTimer) });

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

  // Governance client (workspace-config-driven; reads agent_id and target URLs).
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

  const targetKey = "default";

  function paintIdle(count: number) {
    const cfg = vscode.workspace.getConfiguration("openbox");
    const out = buildIdleStatusBar({
      count,
      debugBuild: DEBUG_BUILD,
      preWriteGateActive: cfg.get<boolean>("preWriteGate.active", false),
      tabObserverEnabled: cfg.get<boolean>("tabObserver.enabled", false),
      tabObserverActive: cfg.get<boolean>("tabObserver.active", false),
      fileOpGateEnabled: cfg.get<boolean>("fileOpGate.enabled", false),
      haveAgent: !!cfg.get<string>("agentId", "").trim(),
    });
    statusBar.text = out.text;
    if (out.tooltip !== undefined) statusBar.tooltip = out.tooltip;
  }

  function statusTagFor(state: string): string {
    return statusTagForPure(state, DEBUG_BUILD);
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

  /** Mirror dashboard pending rows into ApprovalStore. The store may
   *  already have the entry (from a hook subprocess's socket push);
   *  upsert merges fields without clobbering the resolver. Out-of-band
   *  resolutions (dashboard reviewer click) land here on the next
   *  poll tick; store.resolve fires resolver if any, dismisses toast,
   *  refreshes panel. */
  function syncPollRows(rows: Approval[]) {
    const seen = new Set<string>();
    for (const r of rows) {
      const key = approvalStoreKey(r);
      if (!key) continue;
      seen.add(key);
      if (r.agent_id && r.agent?.agent_name) {
        agentNameCache.set(r.agent_id, r.agent.agent_name);
      }
      const status = (r.status ?? "").toLowerCase();
      if (status === "pending" || (!r.decided_at && !status)) {
        const existing = approvalStore.get(key) ?? approvalStore.get(r.id);
        approvalStore.upsert({
          governance_event_id: key,
          agent_id: r.agent_id ?? "",
          agent_name:
            r.agent?.agent_name ??
            existing?.agent_name ??
            (r.agent_id ? agentNameCache.get(r.agent_id) : undefined),
          hook_event_name:
            existing?.hook_event_name ??
            (r.action_type || r.activity_type || "approval"),
          source: existing?.source ?? "poll",
          summary:
            existing?.summary ??
            pollRowSummary(r),
          reason: r.reason ?? "",
          expires_at:
            r.approval_expired_at ??
            new Date(Date.now() + 30 * 60_000).toISOString(),
          created_at:
            existing?.created_at ?? Date.now(),
          status: "pending",
          resolver: existing?.resolver,
        });
      } else if (
        approvalStore.get(key)?.status === "pending" ||
        approvalStore.get(r.id)?.status === "pending"
      ) {
        approvalStore.resolve(
          key,
          status === "approved"
            ? "approved"
            : status === "rejected"
              ? "rejected"
              : "expired",
        );
        if (key !== r.id) {
          approvalStore.resolve(
            r.id,
            status === "approved"
              ? "approved"
              : status === "rejected"
                ? "rejected"
                : "expired",
          );
        }
      }
    }
    // Anything pending in the store but not in the latest poll is
    // missing from the dashboard's view; backend resolved/expired it.
    // Mark expired so the toast clears. Socket-source entries get a
    // short grace window because they can arrive from a hook before the
    // next backend pending poll has caught up.
    const now = Date.now();
    for (const e of approvalStore.pending()) {
      const socketGraceElapsed =
        e.source === "socket" && now - e.created_at > 5_000;
      if (
        (e.source === "poll" || socketGraceElapsed) &&
        !seen.has(e.governance_event_id)
      ) {
        approvalStore.resolve(e.governance_event_id, "expired");
      }
    }
  }

  function approvalStoreKey(r: Approval): string {
    const eventId = (r as { event_id?: string }).event_id;
    return eventId || r.id;
  }

  function pollRowSummary(r: Approval): string {
    const inputAny = r.input as unknown;
    const arr = Array.isArray(inputAny) ? inputAny : [inputAny];
    const first = (arr[0] ?? {}) as Record<string, unknown>;
    return (
      (first?.command as string) ??
      (first?.file_path as string) ??
      (first?.tool_name as string) ??
      (first?.prompt as string) ??
      r.activity_type ??
      ""
    );
  }

  function approvalStateToApproval(state: ApprovalState): Approval {
    return {
      id: state.governance_event_id,
      event_id: state.governance_event_id,
      agent_id: state.agent_id,
      status: state.status,
      action_type: state.hook_event_name,
      activity_type: state.hook_event_name,
      verdict: 2,
      reason: state.reason,
      created_at: new Date(state.created_at).toISOString(),
      approval_expired_at: state.expires_at,
      agent: state.agent_name ? { agent_name: state.agent_name } : undefined,
      input: [{
        summary: state.summary,
        source: state.source,
      }],
    };
  }

  function resolvedEventToApproval(event: ResolvedApprovalEvent): Approval {
    const entry = event.entry;
    return {
      id: event.eventId,
      event_id: event.eventId,
      agent_id: event.agentId,
      status: event.status,
      action_type: entry?.hook_event_name ?? "approval",
      activity_type: entry?.hook_event_name ?? "approval",
      verdict: event.status === "rejected" ? VERDICT_HALT : 2,
      reason: entry?.reason ?? "",
      created_at: entry
        ? new Date(entry.created_at).toISOString()
        : new Date().toISOString(),
      decided_at: new Date().toISOString(),
      agent: entry?.agent_name ? { agent_name: entry.agent_name } : undefined,
      input: [{
        summary: entry?.summary ?? "",
        source: entry?.source ?? "decision",
      }],
    };
  }

  function applyResolvedApprovalToViews(event: ResolvedApprovalEvent) {
    historyDecisionOverlay.set(
      event.eventId,
      resolvedEventToApproval(event),
    );
    active?.history.setOverlayApprovals?.(
      Array.from(historyDecisionOverlay.values()),
    );
    active?.pending.setOverlayApprovals?.(
      approvalStore.pending().map(approvalStateToApproval),
    );
  }

  async function decideApprovalAndRefresh(
    approval: Pick<Approval, "id" | "agent_id">,
    decision: "approve" | "reject",
  ): Promise<boolean> {
    const current = active;
    if (!current) return false;
    const ok = await resolveApproval(
      approvalStore,
      current.client,
      approval.id,
      approval.agent_id,
      decision,
      async (event) => {
        applyResolvedApprovalToViews(event);
      },
    );
    if (!ok) return false;
    await Promise.all([
      current.pending.refresh(),
      current.history.refresh(),
    ]);
    return true;
  }

  async function hydratePendingAgentNames(states: ApprovalState[]) {
    const client = active?.client;
    if (!client) return;
    const missing = states.filter(
      (state) =>
        state.agent_id &&
        !state.agent_name &&
        !agentNameCache.has(state.agent_id),
    );
    await Promise.all(
      missing.map(async (state) => {
        try {
          const agent = (await client.getAgent(state.agent_id)) as
            | { agent_name?: string }
            | null;
          const name =
            typeof agent?.agent_name === "string" && agent.agent_name.trim()
              ? agent.agent_name.trim()
              : undefined;
          agentNameCache.set(state.agent_id, name);
          if (name) {
            approvalStore.upsert({ ...state, agent_name: name });
          }
        } catch {
          agentNameCache.set(state.agent_id, undefined);
        }
      }),
    );
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

  // Self-rescheduled retry timer for the network-failure path inside
  // boot(). The tooltip on the "Disconnected" status bar promises the
  // extension reconnects on its own, so we owe the user an actual
  // timer here instead of waiting for a manual reboot command. Backoff
  // doubles on each failed attempt, capped at 30s, and resets the
  // moment boot() makes it past getProfile.
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectDelayMs = 2_000;
  const RECONNECT_DELAY_MAX_MS = 30_000;
  function cancelReconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
    reconnectDelayMs = 2_000;
  }
  function scheduleReconnect() {
    if (reconnectTimer) return;
    const delay = reconnectDelayMs;
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, RECONNECT_DELAY_MAX_MS);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void boot();
    }, delay);
  }
  context.subscriptions.push({ dispose: () => cancelReconnect() });

  async function boot() {
    cancelReconnect();
    // Wipe everything tied to the previous boot before we start the
    // next one. Prevents a stale detail panel from sitting on top of
    // a sign-out / reconnect and the Profile tree from showing a
    // previous identity until the new poll lands.
    if (active) {
      active.pending.dispose();
      active.history.dispose();
      active = undefined;
    }
    ApprovalDetailPanel.disposeCurrent();
    profileProvider.refresh();

    statusBar.text = `$(openbox-logo) Connecting`;
    statusBar.tooltip = "Connecting to OpenBox…";
    vscode.commands.executeCommand("setContext", "openbox.hasApprovals", false);
    vscode.commands.executeCommand("setContext", "openbox.history.hasApprovals", false);

    if (!hasApiKey()) {
      vscode.commands.executeCommand("setContext", "openbox.needsKey", true);
      statusBar.text = `$(openbox-logo) ${statusTagFor("Connect")}`;
      statusBar.tooltip = "OpenBox is not connected. Add the OpenBox key provided by your organization.";
      statusBar.command = "openbox.setApiKey";
      return;
    }
    vscode.commands.executeCommand("setContext", "openbox.needsKey", false);
    statusBar.command = "openbox.approvals.focus";

    let client: OpenBoxClient;
    try {
      const ctx = await createApiContext();
      client = ctx.client;
    } catch (err: any) {
      const msg = connectionErrorMessage(err);
      statusBar.text = `$(openbox-logo) ${statusTagFor("Connect")}`;
      statusBar.tooltip = msg;
      vscode.window.showErrorMessage(`OpenBox: ${msg}`);
      return;
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
    let activeKey: ActiveKeyInfo | undefined;
    let activeKeyError: string | undefined;
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
        statusBar.text = `$(openbox-logo) ${statusTagFor("Connection Issue")}`;
        statusBar.tooltip = "OpenBox connected, but the account could not be verified.";
        return;
      }
      const who = email || preferredUsername || userSub;
      statusBar.tooltip = who ? `OpenBox connected as ${who}.` : "OpenBox connected.";
    } catch (err: any) {
      // Distinguish "can't reach the API" from "API rejected us"
      // (bad key / real error). The two signals belong on the bar
      // separately so the user knows whether to check their network
      // vs. their credentials.
      const msg = err?.message ?? String(err);
      const isNetwork = /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|getaddrinfo/i.test(msg);
      const label = isNetwork ? "Disconnected" : "Error";
      statusBar.text = `$(openbox-logo) ${statusTagFor(label)}`;
      statusBar.tooltip = isNetwork
        ? connectionErrorMessage(msg)
        : connectionErrorMessage(err);
      if (isNetwork) scheduleReconnect();
      return;
    }

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

    paintIdle(0);

    const refreshActive = () => {
      active?.pending.refresh();
      active?.history.refresh();
    };

    const sessionDeps = {
      context,
      client,
      orgId: orgId!,
      targetKey,
      userSub,
      teams: () => teams,
      members: () => members,
      agentOwnerLookup: (id: string) => agentOwnerCache.get(id),
      resolveAgentOwners,
      onPendingCount: (count: number) => paintIdle(count),
      onError: (where: string, err: Error) =>
        console.error(`OpenBox ${where} feed error:`, err.message),
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
        // ApprovalToastView (subscribes to ApprovalStore) is the only
        // notification path. It already shows one Approve/Deny toast
        // per pending row regardless of source (socket from local
        // hook subprocesses, or poll-discovered out-of-band rows
        // from another agent / the dashboard). Both onNew callbacks
        // are no-ops so the batch summary "N new approvals"
        // pending"; historically used alongside the toasts; no
        // longer fires on parallel tool-call batches.
        onNewApproval: () => undefined,
        onNewBatch: () => undefined,
        onApprovalsRefreshed: (rows) => {
          syncHaltedApprovals(rows);
          // Feed the store with whatever the dashboard sees on each
          // poll cycle. Out-of-band approvals (created via dashboard
          // web UI / programmatic API) land here; resolutions made
          // via dashboard reach the store the same way and propagate
          // to the toast view via store.onChange.
          syncPollRows(rows);
        },
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
    active.pending.setOverlayApprovals?.(
      approvalStore.pending().map(approvalStateToApproval),
    );
    profileProvider.refresh();
    debugProvider?.refresh();
  }

  // Register commands BEFORE `boot()` so a click on a stale tree
  // item rendered during reinstall/reload doesn't surface as
  // "command 'openbox.openDetail' not found". Boot is async (network
  // calls to validate the API key, fetch org metadata, seed the
  // first poll); registrations enqueued *after* boot leave a window
  // where VS Code thinks the extension is active but the command
  // registry still has nothing. Every handler below already checks
  // `if (!active)` and falls back to a "still booting" toast so
  // pre-boot invocations are safe.
  context.subscriptions.push(
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
        decideApproval: decideApprovalAndRefresh,
      });
    }),
    vscode.commands.registerCommand("openbox.copyDetail", (value: string) => {
      vscode.env.clipboard.writeText(value);
    }),
    vscode.commands.registerCommand("openbox.refresh", () => {
      active?.pending.refresh();
      active?.history.refresh();
    }),
  );

  await boot();
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
      // Gate-toggle / agentId changes only repaint the idle status -
      // no polling restart needed.
      if (
        e.affectsConfiguration("openbox.agentId") ||
        e.affectsConfiguration("openbox.preWriteGate.active") ||
        e.affectsConfiguration("openbox.tabObserver.active") ||
        e.affectsConfiguration("openbox.fileOpGate.enabled")
      ) {
        paintIdle(active?.pending.count ?? 0);
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
  const pickApproval = (node: any): Approval | undefined =>
    pickApprovalPure(node, {
      pending: active?.pending.approvals ?? [],
      history: active?.history.approvals ?? [],
    });

  function describeKeySource(): string {
    const url = apiKeysUrl();
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
    const tokenEntry = readStore();
    return {
      sub: active?.sub,
      email: active?.email,
      name: active?.name,
      preferredUsername: active?.preferredUsername,
      emailVerified: active?.emailVerified,
      orgId: active?.orgId,
      hasApiKey: hasApiKey(),
      keyPrefix: apiKeyPrefix(),
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
    registerScopedCommand("openbox.setPageSize", "pending", "setPageSize"),
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
    registerScopedCommand("openbox.history.setPageSize", "history", "setPageSize"),

    vscode.commands.registerCommand("openbox.approve", async (node: any) => {
      const approval = pickApproval(node);
      if (!approval || !active) return;
      const ok = await resolveApproval(
        approvalStore,
        active.client,
        approval.id,
        approval.agent_id,
        "approve",
        async (event) => {
          applyResolvedApprovalToViews(event);
        },
      );
      if (ok) {
        await Promise.all([active.pending.refresh(), active.history.refresh()]);
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
      const ok = await resolveApproval(
        approvalStore,
        active.client,
        approval.id,
        approval.agent_id,
        "reject",
        async (event) => {
          applyResolvedApprovalToViews(event);
        },
      );
      if (ok) {
        await Promise.all([active.pending.refresh(), active.history.refresh()]);
      }
    }),

    // openbox.refresh, openbox.copyDetail, openbox.openDetail are
    // registered before boot() above so they survive activation
    // races (tree-item click during reinstall reload).

    vscode.commands.registerCommand("openbox.setApiKey", async () => {
      const value = await vscode.window.showInputBox({
        title: "OpenBox: Connect",
        prompt: "Paste the OpenBox key provided by your organization.",
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
        vscode.window.showErrorMessage("Invalid OpenBox key.");
        return;
      }

      // Round-trip /auth/profile to confirm the key works before
      // persisting. Progress notification gives the user feedback
      // during the network call.
      const ok = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "OpenBox: validating connection…",
          cancellable: false,
        },
        async () => {
          try {
            // Stage the key on disk first so createApiContext picks
            // it up; rollback below if /auth/profile rejects.
            writeApiKey(trimmed);
            const ctx = await createApiContext();
            const profile: any = await ctx.client.getProfile();
            return {
              ok: true as const,
              profile,
            };
          } catch (err: any) {
            // Rollback: drop the key we just staged so a bad paste
            // doesn't poison the next boot.
            try {
              clearApiKey();
            } catch {
              /* silent */
            }
            return { ok: false as const, message: String(err?.message ?? err) };
          }
        },
      );

      if (!ok.ok) {
        const choice = await vscode.window.showErrorMessage(
          `OpenBox connection failed: ${connectionErrorMessage(ok.message)}`,
          "Try Again",
        );
        if (choice === "Try Again") {
          vscode.commands.executeCommand("openbox.setApiKey");
        }
        return;
      }
      const who =
        ok.profile.email || ok.profile.preferred_username || ok.profile.sub || "unknown user";
      vscode.window.showInformationMessage(`OpenBox connected${who ? ` as ${who}` : ""}.`);
      void boot();
    }),

    vscode.commands.registerCommand("openbox.openDashboard", async () => {
      const url = apiKeysUrl();
      if (!url) {
        vscode.window.showInformationMessage("OpenBox dashboard is not configured.");
        return;
      }
      vscode.env.openExternal(vscode.Uri.parse(url));
    }),

    vscode.commands.registerCommand("openbox.clearCredentials", async () => {
      const choice = await vscode.window.showWarningMessage(
        "Clear OpenBox connection?",
        {
          modal: true,
          detail: "This removes the saved OpenBox key from this machine.",
        },
        "Clear",
      );
      if (choice !== "Clear") return;
      const p = resolveOsPath("tokens");
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
        vscode.window.showInformationMessage("OpenBox connection cleared.");
        void boot();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to clear credentials: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand("openbox.signOut", async () => {
      const choice = await vscode.window.showWarningMessage(
        "Disconnect OpenBox?",
        {
          modal: true,
          detail: "This removes the saved OpenBox key from this machine.",
        },
        "Disconnect",
      );
      if (choice !== "Disconnect") return;
      try {
        clearApiKey();
        void boot();
        vscode.window.showInformationMessage("OpenBox disconnected.");
      } catch (err: any) {
        vscode.window.showErrorMessage(`Sign out failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand("openbox.reboot", () => void boot()),

    vscode.commands.registerCommand("openbox.openWalkthrough", () => {
      vscode.commands.executeCommand(
        "workbench.action.openWalkthrough",
        "OpenBox.openbox#openbox.gettingStarted",
        false,
      );
    }),

    vscode.commands.registerCommand("openbox.__diag.extensionBuild", () => ({
      id: context.extension.id,
      version: String(context.extension.packageJSON?.version ?? ""),
      extensionPath: context.extensionPath,
      mode: context.extensionMode,
    })),

    // Diagnostic: governance.check from the extension host with the
    // configured agent + target URLs. Used by the live e2e suite.
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
        mockAuth: vscode.workspace.getConfiguration("openbox").get<boolean>("mockAuth", false),
        agentId: governance.agentId(),
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

    // Diagnostic: run governance.check directly with caller-supplied
    // span_type + activity_input. Tests assert verdict mapping for
    // every BehaviorVerdict numeric (0/1/2/3/4) end-to-end through
    // the SDK's governance check helper, without going via the
    // file-save pipeline.
    vscode.commands.registerCommand(
      "openbox.__diag.governanceCheck",
      async (spanType: string, activityInput: Record<string, unknown>) => {
        const result = await governance.check({
          spanType: spanType as Parameters<typeof governance.check>[0]["spanType"],
          activityInput,
        });
        return result;
      },
    ),

    // Diagnostic: count of currently-recorded halt-verdict denies on
    // the PreWriteGate. Tests assert that pending halt approvals
    // transitioning out of pending clear their gate entry.
    vscode.commands.registerCommand("openbox.__diag.haltedCount", () => {
      return haltedApprovals.size;
    }),

    // Diagnostic: pending-approvals count from the live polling
    // layer. Used by LIVE e2e to assert that an approval created
    // via governance.check shows up in the user-visible pending view
    // after the next poll cycle.
    vscode.commands.registerCommand("openbox.__diag.approvalsCount", () => {
      return active?.pending.count ?? 0;
    }),

    // Diagnostic: compact pending rows for live e2e cleanup and
    // targeted lifecycle assertions. Keep the payload narrow so tests
    // never need to inspect full approval objects.
    vscode.commands.registerCommand("openbox.__diag.pendingApprovals", () => {
      return (active?.pending.approvals ?? []).map((a) => ({
        id: a.id,
        agent_id: a.agent_id,
        activity_type: a.activity_type,
        input: a.input,
      }));
    }),

    // Diagnostic: snapshot of the status bar's currently-painted
    // text + tooltip. Test infra reads this instead of trying to
    // grep the DOM through wdio (DOM selectors break across VS Code
    // versions; the StatusBarItem state is the canonical source).
    vscode.commands.registerCommand("openbox.__diag.statusBar", () => {
      return { text: statusBar.text, tooltip: String(statusBar.tooltip ?? "") };
    }),

    // Diagnostic: bypass-modal decide. The user-facing openbox.reject
    // shows a confirmation modal that wdio can't dismiss from inside
    // executeWorkbench; this fires the same network call directly so
    // tests can assert the round-trip + UI updates without simulating
    // a click. The modal-confirmation path itself is unit-tested.
    vscode.commands.registerCommand(
      "openbox.__diag.decide",
      async (
        approval: { id?: string; agent_id?: string } | undefined,
        action: "approve" | "reject",
      ) => {
        const id = approval?.id;
        const agentId = approval?.agent_id;
        if (!id || !active) return false;
        return decideApprovalAndRefresh(
          { id, agent_id: agentId ?? "" },
          action,
        );
      },
    ),

    // Diagnostic: open the detail panel programmatically. Returns
    // {ok: true} when the WebviewPanel materialised cleanly. Tests
    // assert the openDetail command resolves; the rendered HTML is
    // unit-tested with a mocked WebviewPanel API.
    vscode.commands.registerCommand("openbox.__diag.openDetail", async (id: string) => {
      try {
        await vscode.commands.executeCommand("openbox.openDetail", id);
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    }),
  );

  if (DEBUG_BUILD) {
    context.subscriptions.push(
      vscode.commands.registerCommand("openbox.showDebugInfo", () => {
        showDebugInfoPanel(context, buildDebugSnapshot);
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
