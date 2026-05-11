// One ViewSession per OpenBox tree view (pending, history). Owns its
// tree provider, polling service, filter state, and view-scoped command
// registrations. Two parallel sessions live side-by-side in the same
// activity-bar container; they share the OpenBoxClient + roster caches
// from extension.ts but otherwise don't talk to each other.

import * as vscode from "vscode";
import type { OpenBoxClient } from "openbox-sdk/client";
import { ApprovalsTreeProvider } from "./approvalsView";
import {
  EMPTY_FILTERS,
  applyClientFilters,
  hasActiveFilters,
  loadFilters,
  saveFilters,
  summarizeFilters,
  type FilterState,
} from "./filters";
import {
  pickCategory,
  pickDateRange,
  pickOwner,
  pickSearch,
  pickStatus,
  pickTeam,
  pickTier,
  pickType,
  toggleSort,
  type FilterController,
} from "./filterCommands";
import { PollingService } from "./polling";
import type { Approval, Member, Team } from "./types";

export interface SessionDeps {
  context: vscode.ExtensionContext;
  client: OpenBoxClient;
  orgId: string;
  env: string;
  userSub: string | undefined;
  teams: () => Team[];
  members: () => Member[];
  agentOwnerLookup: (agentId: string) => string | undefined;
  resolveAgentOwners: (agentIds: string[]) => Promise<void>;
  onPendingCount?: (count: number) => void;
  onError: (where: string, err: Error) => void;
  // Pending uses this; history doesn't (decided rows shouldn't toast).
  notifyOnNew: boolean;
  onNewApproval: (a: Approval, env: string) => void;
  onNewBatch: (count: number, env: string) => void;
  /** Fires every time the feed reports a new approvals snapshot.
   *  PreWriteGate's halt-verdict tracking subscribes here so it can
   *  paint denies for any URI-open file whose approval is at verdict
   *  4 - and clear them when the same approval drops out of pending. */
  onApprovalsRefreshed?: (approvals: Approval[]) => void;
}

export interface SessionConfig {
  viewId: string;          // openbox.approvals | openbox.history
  scope: string;           // pending | history
  cmdNs: string;           // openbox | openbox.history
  initialStatus?: "pending" | "approved" | "rejected" | "expired";
  pollMs?: number;
  // History allows the user to switch status; pending pins "pending."
  supportsStatus: boolean;
  // History groups its (decided) approvals under Approved / Rejected /
  // Expired section headers; pending stays a flat list. Equivalent to
  // mobile's segmented picker but doesn't force one-status-at-a-time.
  groupByStatus?: boolean;
  ctxPrefix: string;       // openbox | openbox.history (for hasFilters/hasApprovals context keys)
}

export class ViewSession implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly treeProvider: ApprovalsTreeProvider;
  private readonly treeView: vscode.TreeView<unknown>;
  private filters: FilterState;
  private feed: PollingService;
  // Activity types seen across all polls in this session. Sticky on
  // purpose: filtering down to one tier shouldn't shrink the type
  // picker to that tier's types only. Mirrors mobile's
  // `seenActivityTypesRef`.
  private seenActivityTypes = new Set<string>();
  // First poll hasn't returned yet. Drives the `<ctxPrefix>.loading`
  // context key so welcome views can show "Loading…" instead of the
  // empty-state copy. Mobile achieves the same with `hasLoaded`
  // gating its empty-state component.
  private firstLoadPending = true;

  constructor(
    private readonly cfg: SessionConfig,
    private readonly deps: SessionDeps,
  ) {
    this.filters = loadFilters(deps.context.globalState, cfg.scope, deps.env);
    if (cfg.supportsStatus && this.filters.status === undefined) {
      // History default is "all" (status undefined). Persist nothing
      // unusual; just mirror what the user previously chose.
    }

    this.treeProvider = new ApprovalsTreeProvider({ groupByStatus: cfg.groupByStatus });
    this.treeProvider.setLoadMoreCommand(`${cfg.cmdNs}.loadMore`);
    this.treeView = vscode.window.createTreeView(cfg.viewId, { treeDataProvider: this.treeProvider });
    this.disposables.push(this.treeView, this.treeProvider);

    const status = cfg.supportsStatus ? this.filters.status : cfg.initialStatus;
    this.feed = new PollingService(deps.client, deps.orgId, {
      status,
      pollMs: cfg.pollMs,
      filters: this.filters,
    });

    this.feed.on("changed", (approvals: Approval[]) => {
      // Sticky union - never removes types, even when a filter narrows
      // the result. The picker's "All types" entry plus this set are
      // what the user picks from regardless of the live filter state.
      for (const a of approvals) {
        const t = a.action_type || a.activity_type;
        if (t) this.seenActivityTypes.add(t);
      }
      void this.applyDisplay(approvals);
      // Pre-write gate halt-verdict tracking is fed from the same
      // snapshot. Pending-only callers wire this; history doesn't
      // carry verdict-4 rows that are still actionable.
      this.deps.onApprovalsRefreshed?.(approvals);
    });
    this.feed.on("newApprovals", (newOnes: Approval[]) => this.handleNewBatch(newOnes));
    this.feed.on("error", (err: Error) => deps.onError(cfg.scope, err));

    // Initial loading=true so the welcome view shows "Loading…"
    // until the first poll lands. applyDisplay flips it false on the
    // first changed event regardless of whether the result is empty.
    vscode.commands.executeCommand("setContext", `${cfg.ctxPrefix}.loading`, true);

    this.feed.start();
    this.paintBanner();
    this.disposables.push({
      dispose: () => {
        this.feed.stop();
        vscode.commands.executeCommand("setContext", `${cfg.ctxPrefix}.loading`, false);
      },
    });

    // Commands now registered once in extension.ts; we just expose
    // the action methods (search, filter, refresh, loadMore, ...).
  }

  refresh() { void this.feed.refresh(); }

  /** Live snapshot of the polled approvals. Used by extension.ts's
   *  openDetail handler to look up an approval by id when other
   *  surfaces (preWriteGate's deny modal, slash-command callbacks)
   *  hand it a bare approvalId string. */
  get approvals(): Approval[] { return this.feed.approvals; }

  // Telemetry surfaces for the debug panel.
  get count(): number { return this.feed.approvals.length; }
  get lastPollAt(): number | undefined { return this.feed.lastPollAt; }
  get lastErrorAt(): number | undefined { return this.feed.lastErrorAt; }
  get lastErrorMessage(): string | undefined { return this.feed.lastErrorMessage; }
  get errorCount(): number { return this.feed.errorCount; }

  private handleNewBatch(newOnes: Approval[]) {
    if (!this.deps.notifyOnNew) return;
    if (newOnes.length === 1) {
      this.deps.onNewApproval(newOnes[0], this.deps.env);
    } else {
      this.deps.onNewBatch(newOnes.length, this.deps.env);
    }
  }

  private async applyDisplay(approvals: Approval[]) {
    if (this.filters.ownerId) {
      const ids = Array.from(new Set(approvals.map((a) => a.agent_id).filter(Boolean) as string[]));
      await this.deps.resolveAgentOwners(ids);
    }
    const display = applyClientFilters(approvals, this.filters, this.deps.agentOwnerLookup);
    this.treeProvider.update(display, this.feed.hasMore);
    const count = display.length;
    this.treeView.badge = count > 0 ? { value: count, tooltip: `${count} ${this.cfg.scope}` } : undefined;
    vscode.commands.executeCommand("setContext", `${this.cfg.ctxPrefix}.hasApprovals`, count > 0);
    if (this.firstLoadPending) {
      this.firstLoadPending = false;
      vscode.commands.executeCommand("setContext", `${this.cfg.ctxPrefix}.loading`, false);
    }
    if (this.cfg.scope === "pending") this.deps.onPendingCount?.(count);
  }

  private paintBanner() {
    const teams = this.deps.teams();
    const members = this.deps.members();
    const summary = summarizeFilters(this.filters, {
      teamName: (id) => teams.find((t) => t.id === id)?.name,
      ownerName: (id) => {
        if (id === this.deps.userSub) return "Me";
        const m = members.find((x) => x.id === id);
        return m ? (m.firstName || m.username || m.email || m.id) : undefined;
      },
    });
    this.treeView.message = summary;
    vscode.commands.executeCommand("setContext", `${this.cfg.ctxPrefix}.hasFilters`, hasActiveFilters(this.filters));
  }

  private controller: FilterController = {
    current: () => this.filters,
    update: async (next) => {
      this.filters = { ...this.filters, ...next };
      for (const k of ["search", "tier", "activityType", "teamId", "ownerId"] as const) {
        if (this.filters[k] === "" || this.filters[k] == null) (this.filters as any)[k] = undefined;
      }
      await saveFilters(this.deps.context.globalState, this.cfg.scope, this.deps.env, this.filters);
      this.paintBanner();
      // Status changes go through the dedicated setter so PollingService
      // resets the seed gate; otherwise setFilters' reset is enough.
      if (this.cfg.supportsStatus && "status" in (next as any)) {
        this.feed.setStatus(this.filters.status);
      }
      this.feed.setFilters(this.filters);
    },
    clear: async () => {
      // Sort is a view preference, not a data filter; mobile's
      // clearAllFilters preserves it and so do we. Resetting it would
      // surprise users who set "oldest" once and forgot.
      const preservedSort = this.filters.sort;
      this.filters = { ...EMPTY_FILTERS, sort: preservedSort };
      await saveFilters(this.deps.context.globalState, this.cfg.scope, this.deps.env, this.filters);
      this.paintBanner();
      if (this.cfg.supportsStatus) this.feed.setStatus(undefined);
      this.feed.setFilters(this.filters);
    },
    seenActivityTypes: () => Array.from(this.seenActivityTypes).sort(),
    client: () => this.deps.client,
    orgId: () => this.deps.orgId,
    teams: () => this.deps.teams(),
    members: () => this.deps.members(),
    currentUserSub: () => this.deps.userSub,
    supportsStatus: () => this.cfg.supportsStatus,
  };

  /** Public action surface so extension.ts's stable command
   *  registrations can dispatch through whichever ViewSession is
   *  currently active. The previous implementation registered
   *  vscode.commands itself, which meant the title-bar buttons
   *  surfaced "command not found" until the first successful boot
   *  built a ViewSession. Now every command id is registered once
   *  in extension.ts, the handler resolves to active?.<scope> at
   *  call time, and a friendly toast appears if the boot hasn't
   *  finished yet. */
  search() { void pickSearch(this.controller); }
  filter() { void pickCategory(this.controller); }
  filterTier() { void pickTier(this.controller); }
  filterType() { void pickType(this.controller); }
  filterTeam() { void pickTeam(this.controller); }
  filterOwner() { void pickOwner(this.controller); }
  toggleSort() { void toggleSort(this.controller); }
  clearFilters() { void this.controller.clear(); }
  loadMore() { void this.feed.loadMore(); }
  setStatus() {
    if (!this.cfg.supportsStatus) return;
    void pickStatus(this.controller);
  }
  setDateRange() {
    if (!this.cfg.supportsStatus) return;
    void pickDateRange(this.controller);
  }

  // Used by extension.ts when the env switches; the session is torn
  // down and a fresh one is built for the new env.
  dispose() {
    while (this.disposables.length) {
      const d = this.disposables.pop();
      try { d?.dispose(); } catch { /* ignore */ }
    }
  }
}

