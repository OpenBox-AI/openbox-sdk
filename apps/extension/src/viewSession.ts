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
import { ApprovalsPollingService } from "openbox-sdk/polling";
import { statusOf } from "openbox-sdk/approvals";
import type { Approval, Member, Team } from "./types";

const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500] as const;

function setContext(key: string, value: unknown): void {
  void vscode.commands
    .executeCommand("setContext", key, value)
    .then(undefined, () => undefined);
}

export interface SessionDeps {
  context: vscode.ExtensionContext;
  client: OpenBoxClient;
  orgId: string;
  targetKey: string;
  userSub: string | undefined;
  teams: () => Team[];
  members: () => Member[];
  agentOwnerLookup: (agentId: string) => string | undefined;
  resolveAgentOwners: (agentIds: string[]) => Promise<void>;
  onPendingCount?: (count: number) => void;
  onError: (where: string, err: Error) => void;
  // Pending uses this; history doesn't (decided rows shouldn't toast).
  notifyOnNew: boolean;
  onNewApproval: (a: Approval, targetKey: string) => void;
  onNewBatch: (count: number, targetKey: string) => void;
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
  private pageSize: number;
  private feed: ApprovalsPollingService;
  private overlayApprovals: Approval[] = [];
  private overlaySet = false;
  private displayVersion = 0;
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
    this.filters = loadFilters(deps.context.globalState, cfg.scope, deps.targetKey);
    this.pageSize = loadPageSize(deps.context.globalState, cfg.scope, deps.targetKey);
    if (cfg.supportsStatus && this.filters.status === undefined) {
      // History default is "all" (status undefined). Persist nothing
      // unusual; just mirror what the user previously chose.
    }

    this.treeProvider = new ApprovalsTreeProvider({
      groupByStatus: cfg.groupByStatus,
      showLoadMore: !cfg.groupByStatus,
    });
    this.treeProvider.setLoadMoreCommand(`${cfg.cmdNs}.loadMore`);
    this.treeView = vscode.window.createTreeView(cfg.viewId, { treeDataProvider: this.treeProvider });
    this.disposables.push(this.treeView, this.treeProvider);

    const status = cfg.supportsStatus ? this.filters.status : cfg.initialStatus;
    const strictSourceFilter = vscode.workspace
      .getConfiguration("openbox")
      .get<boolean>("strictSourceFilter", false);

    this.feed = new ApprovalsPollingService(deps.client, deps.orgId, {
      status,
      intervalMs: cfg.pollMs,
      perPage: this.pageSize,
      filters: this.filters,
      // Scope the approvals tree to the host that owns this
      // extension. The Cursor IDE should only surface approvals
      // originating from Cursor; approvals from other hosts belong
      // in the source-neutral desktop approver and mobile app.
      // Approvals with no resolvable source pass through by default
      // so a real row never vanishes silently; the user can flip
      // `openbox.strictSourceFilter` on to also hide unattributable
      // rows (the backend's pending-list endpoint strips spans, so
      // most live rows fall into the unresolvable bucket).
      sourceFilter: "cursor",
      strictSourceFilter,
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
    setContext(`${cfg.ctxPrefix}.loading`, true);

    this.feed.start();
    this.paintBanner();
    this.disposables.push({
      dispose: () => {
        this.feed.stop();
        setContext(`${cfg.ctxPrefix}.loading`, false);
      },
    });

    // Commands now registered once in extension.ts; we just expose
    // the action methods (search, filter, refresh, loadMore, ...).
  }

  async refresh(): Promise<void> {
    await this.feed.refresh();
    await this.applyDisplay(this.feed.approvals);
  }

  setOverlayApprovals(approvals: Approval[]) {
    this.overlayApprovals = approvals;
    this.overlaySet = true;
    void this.applyDisplay(this.feed.approvals);
  }

  /** Live snapshot of the polled approvals. Used by extension.ts's
   *  openDetail handler to look up an approval by id when other
   *  surfaces (preWriteGate's deny modal, slash-command callbacks)
   *  hand it a bare approvalId string. */
  get approvals(): Approval[] {
    if (this.cfg.scope === "pending" && this.overlaySet) {
      return this.overlayApprovals;
    }
    return mergeApprovals(this.feed.approvals, this.overlayApprovals);
  }

  // Telemetry surfaces for the debug panel.
  get count(): number { return this.approvals.length; }
  get lastPollAt(): number | undefined { return this.feed.lastPollAt; }
  get lastErrorAt(): number | undefined { return this.feed.lastErrorAt; }
  get lastErrorMessage(): string | undefined { return this.feed.lastErrorMessage; }
  get errorCount(): number { return this.feed.errorCount; }

  private handleNewBatch(newOnes: Approval[]) {
    if (!this.deps.notifyOnNew) return;
    if (newOnes.length === 1) {
      this.deps.onNewApproval(newOnes[0], this.deps.targetKey);
    } else {
      this.deps.onNewBatch(newOnes.length, this.deps.targetKey);
    }
  }

  private async applyDisplay(approvals: Approval[]) {
    const version = ++this.displayVersion;
    const source =
      this.cfg.scope === "pending" && this.overlaySet
        ? this.overlayApprovals
        : mergeApprovals(approvals, this.overlayApprovals);
    if (this.filters.ownerId) {
      const ids = Array.from(new Set(source.map((a) => a.agent_id).filter(Boolean) as string[]));
      await this.deps.resolveAgentOwners(ids);
      if (version !== this.displayVersion) return;
    }
    const filtered = applyClientFilters(
      source,
      this.filters,
      this.deps.agentOwnerLookup,
    );
    const visibleBase = this.cfg.groupByStatus
      ? filtered.filter((a) => ["approved", "rejected", "expired"].includes(statusOf(a)))
      : filtered;
    if (version !== this.displayVersion) return;
    const display = visibleBase;
    this.treeProvider.update(display, this.feed.hasMore);
    const count = display.length;
    this.treeView.badge = count > 0 ? { value: count, tooltip: `${count} ${this.cfg.scope}` } : undefined;
    setContext(`${this.cfg.ctxPrefix}.hasApprovals`, count > 0);
    if (this.firstLoadPending) {
      this.firstLoadPending = false;
      setContext(`${this.cfg.ctxPrefix}.loading`, false);
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
    this.treeView.description = `${this.pageSize} items`;
    setContext(`${this.cfg.ctxPrefix}.hasFilters`, hasActiveFilters(this.filters));
  }

  private controller: FilterController = {
    current: () => this.filters,
    update: async (next) => {
      this.filters = { ...this.filters, ...next };
      for (const k of ["search", "tier", "activityType", "teamId", "ownerId"] as const) {
        if (this.filters[k] === "" || this.filters[k] == null) (this.filters as any)[k] = undefined;
      }
      await saveFilters(this.deps.context.globalState, this.cfg.scope, this.deps.targetKey, this.filters);
      this.paintBanner();
      // Status changes go through the dedicated setter so ApprovalsPollingService
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
      await saveFilters(this.deps.context.globalState, this.cfg.scope, this.deps.targetKey, this.filters);
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
  setPageSize() { void this.pickPageSize(); }
  setStatus() {
    if (!this.cfg.supportsStatus) return;
    void pickStatus(this.controller);
  }
  setDateRange() {
    if (!this.cfg.supportsStatus) return;
    void pickDateRange(this.controller);
  }

  dispose() {
    while (this.disposables.length) {
      const d = this.disposables.pop();
      try { d?.dispose(); } catch { /* ignore */ }
    }
  }

  private async pickPageSize(): Promise<void> {
    const picked = await vscode.window.showQuickPick(
      PAGE_SIZE_OPTIONS.map((value) => ({
        label: `${value} items`,
        description: value === this.pageSize ? "Current" : undefined,
        value,
      })),
      {
        placeHolder: "Approval list size",
      },
    );
    if (!picked) return;
    this.pageSize = picked.value;
    await savePageSize(
      this.deps.context.globalState,
      this.cfg.scope,
      this.deps.targetKey,
      picked.value,
    );
    this.feed.setPageSize(picked.value);
    this.paintBanner();
  }
}

function mergeApprovals(base: Approval[], overlay: Approval[]): Approval[] {
  if (overlay.length === 0) return base;
  const byId = new Map<string, Approval>();
  for (const approval of base) byId.set(approval.id, approval);
  for (const approval of overlay) {
    byId.set(approval.id, { ...byId.get(approval.id), ...approval });
  }
  return Array.from(byId.values());
}

function pageSizeKey(scope: string, targetKey: string): string {
  return `openbox.${scope}.pageSize.${targetKey}`;
}

function loadPageSize(state: vscode.Memento, scope: string, targetKey: string): number {
  const value = state.get<number>(pageSizeKey(scope, targetKey), DEFAULT_PAGE_SIZE);
  return normalizePageSize(value);
}

async function savePageSize(
  state: vscode.Memento,
  scope: string,
  targetKey: string,
  value: number,
): Promise<void> {
  await state.update(pageSizeKey(scope, targetKey), normalizePageSize(value));
}

function normalizePageSize(value: number): number {
  if (PAGE_SIZE_OPTIONS.includes(value as (typeof PAGE_SIZE_OPTIONS)[number])) {
    return value;
  }
  return DEFAULT_PAGE_SIZE;
}
