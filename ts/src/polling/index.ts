// Platform-agnostic poll loop for organization approvals. The full
// feature surface (filter-aware queries, paged backlog navigation,
// seed-toast suppression, latency and error telemetry) lives here
// so every consumer (VS Code / Cursor extension, mobile app,
// headless monitor) reads from a single source.
//
// This module does not read env or token state. The
// `OpenBoxClient` instance passed in already knows its environment
// and supplies the auth headers; rebuilding it on env change is the
// consumer's responsibility.
//
// Usage:
//
//   const poll = new ApprovalsPollingService(client, orgId, {
//     status: 'pending',
//     filters: { sort: 'newest', dateRange: 'all' },
//   });
//   poll.on('changed', (approvals) => render(approvals));
//   poll.on('newApprovals', (newOnes) => notify(newOnes));
//   poll.on('error', (err) => log(err));
//   poll.start();
//
// Any of `setFilters`, `setStatus`, and `loadMore` reset both
// `seeded` and `knownIds`. Post-change rows are a different slice
// of the same backlog rather than new arrivals; without the reset,
// switching from Tier 4 to Tier 2 would surface every Tier 2 row
// as if it had just landed.

import { EventEmitter } from 'events';
import type { OpenBoxClient } from '../client/index.js';
import type { Approval } from '../types/index.js';
import {
  dateRangeBounds,
  type FilterState,
} from '../approvals/filters.js';
import { approvalSource } from '../approvals/source.js';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface PollingOptions {
  /** Poll interval in milliseconds. Default 5000. */
  intervalMs?: number;
  /** Initial page size. Each loadMore() grows the request by `perPage` more rows. Default 50. */
  perPage?: number;
  /** Max pages reachable via loadMore() before atPageLimit fires. Default 5. */
  maxPages?: number;
  /** Status filter. Default "pending"; pass `undefined` for "any status". */
  status?: ApprovalStatus;
  /** Approval-side filter state (search/tier/team/date/activityType/sort). */
  filters?: FilterState;
  /** Host-source filter (for example `'cursor'`). When set, drops
   *  approvals whose `approvalSource()` resolves to a different
   *  known host. Rows with no resolvable source (missing `module`
   *  and `gen_ai.system`) pass through by default so stale or
   *  third-party rows do not silently vanish; set `strictSourceFilter`
   *  to also drop those. */
  sourceFilter?: string;
  /** When true, rows whose `approvalSource()` is undefined are
   *  dropped instead of passing through. Backend's pending-list
   *  endpoint strips spans for response size, which makes
   *  `approvalSource()` return undefined for most live rows; use
   *  strict mode when you trust the metadata-source path and want
   *  per-host isolation regardless. */
  strictSourceFilter?: boolean;
}

const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_PER_PAGE = 50;
const DEFAULT_MAX_PAGES = 5;
const DEFAULT_STATUS: ApprovalStatus | undefined = 'pending';

export class ApprovalsPollingService extends EventEmitter {
  private client: OpenBoxClient;
  private orgId: string;
  private intervalMs: number;
  private perPage: number;
  private maxPages: number;
  private status: ApprovalStatus | undefined;
  private filters: FilterState = { sort: 'newest', dateRange: 'all' };
  private sourceFilter: string | undefined;
  private strictSourceFilter = false;
  private knownIds = new Set<string>();
  // Each poll re-fetches page 0 with `perPage = base * loadedPages`.
  // Network cost stays bounded (`perPage * maxPages` is 250 rows by
  // default); load-more progress survives polls because `perPage`
  // remains grown.
  private loadedPages = 1;
  // The first successful poll is a seeding round. Firing
  // `newApprovals` for the entire initial set would violate the VS
  // Code notification guideline against repeated notifications, so
  // the first delta is suppressed. After seeding, deltas represent
  // real arrivals.
  private seeded = false;
  // Set when the next poll is a load-more (paging deeper into the
  // backlog). The newly-paged rows were already on the backend; the
  // change is in the consumer's request, not in the underlying
  // data, so `newApprovals` must not fire for that poll. Cleared
  // after the suppressed poll.
  private suppressNextBatch = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private _approvals: Approval[] = [];
  private lastFingerprints = new Map<string, string>();
  private _hasMore = false;
  // Lightweight telemetry. Public so consumers can build a snapshot
  // without the instance reaching back into them.
  lastPollAt: number | undefined;
  lastErrorAt: number | undefined;
  lastErrorMessage: string | undefined;
  errorCount = 0;

  constructor(client: OpenBoxClient, orgId: string, options: PollingOptions = {}) {
    super();
    this.client = client;
    this.orgId = orgId;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.perPage = options.perPage ?? DEFAULT_PER_PAGE;
    this.maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    // Distinguish "key omitted" (use pending default) from "explicit
    // undefined" (history pane's all-statuses sentinel). `??` /
    // ternary-on-undefined collapses both into the default and was
    // silently turning the history pane into a pending query.
    this.status = 'status' in options ? options.status : DEFAULT_STATUS;
    if (options.filters) this.filters = options.filters;
    this.sourceFilter = options.sourceFilter;
    this.strictSourceFilter = options.strictSourceFilter ?? false;
  }

  get approvals(): Approval[] {
    return this._approvals;
  }
  get hasMore(): boolean {
    return this._hasMore;
  }
  get atPageLimit(): boolean {
    return this.loadedPages >= this.maxPages;
  }
  get pageSize(): number {
    return this.perPage;
  }

  start(): void {
    // Emit an initial `changed` with the empty buffer so consumers
    // can paint a "loading" to "0 pending" transition without
    // waiting for the first network round-trip.
    this.emit('changed', []);
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async refresh(): Promise<void> {
    await this.poll();
  }

  setFilters(filters: FilterState): void {
    this.filters = filters;
    this.loadedPages = 1;
    this.knownIds.clear();
    this.seeded = false;
    void this.poll();
  }

  setStatus(status: ApprovalStatus | undefined): void {
    this.status = status;
    this.loadedPages = 1;
    this.knownIds.clear();
    this.seeded = false;
    void this.poll();
  }

  setPageSize(perPage: number): void {
    const normalized = Math.max(1, Math.floor(perPage));
    if (this.perPage === normalized) return;
    this.perPage = normalized;
    this.loadedPages = 1;
    this.knownIds.clear();
    this.seeded = false;
    void this.poll();
  }

  loadMore(): void {
    if (this.atPageLimit) return;
    this.loadedPages += 1;
    this.suppressNextBatch = true;
    void this.poll();
  }

  private async poll(): Promise<void> {
    try {
      const { fromTime, toTime } = dateRangeBounds(this.filters.dateRange);
      const perPage = this.perPage * this.loadedPages;
      const result = await this.client.getOrgApprovals(this.orgId, {
        status: this.status,
        page: 0,
        perPage,
        search: this.filters.search,
        tiers: this.filters.tier ? [this.filters.tier] : undefined,
        activity_types: this.filters.activityType
          ? [this.filters.activityType]
          : undefined,
        team_ids: this.filters.teamId ? [this.filters.teamId] : undefined,
        fromTime,
        toTime,
      });
      const allApprovals = (result.approvals?.data ?? []) as Approval[];
      // Source filter drops rows whose inferred source resolves to
      // a different known host. By default, rows with no resolvable
      // source (missing `module` and `gen_ai.system`) pass through
      // so a real approval is never hidden by accident; one extra
      // row in the list is preferable to a vanished one. The
      // backend's pending-list endpoint strips spans for response
      // size, which makes `approvalSource()` return undefined for
      // most live rows. Set `strictSourceFilter` to also drop
      // unattributable rows when you want strict per-host isolation.
      const approvals = this.sourceFilter
        ? allApprovals.filter((a) => {
            const src = approvalSource(a);
            if (src === this.sourceFilter) return true;
            if (src === undefined) return !this.strictSourceFilter;
            return false;
          })
        : allApprovals;
      const newFingerprints = new Map(
        approvals.map((a) => [a.id, approvalFingerprint(a)]),
      );

      const brandNew = approvals.filter((a) => !this.knownIds.has(a.id));
      const changed =
        this.lastFingerprints.size !== newFingerprints.size ||
        [...newFingerprints].some(
          ([id, fingerprint]) => this.lastFingerprints.get(id) !== fingerprint,
        );

      this.knownIds = new Set(newFingerprints.keys());
      this.lastFingerprints = newFingerprints;
      this._approvals = approvals;
      // "Has more" = the page came back full. Off-by-one when total is
      // an exact multiple of perPage (last load-more click yields zero
      // new rows); harmless extra click.
      this._hasMore = !this.atPageLimit && approvals.length >= perPage;

      const shouldToast =
        this.seeded && !this.suppressNextBatch && brandNew.length > 0;
      if (shouldToast) {
        this.emit('newApprovals', brandNew);
      }
      if (changed || !this.seeded) {
        this.emit('changed', approvals);
      }
      this.seeded = true;
      this.suppressNextBatch = false;
      this.lastPollAt = Date.now();
    } catch (err: unknown) {
      this.errorCount += 1;
      this.lastErrorAt = Date.now();
      this.lastErrorMessage =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : String(err);
      this.emit('error', err);
    }
  }
}

function approvalFingerprint(a: Approval): string {
  return JSON.stringify({
    id: a.id,
    status: a.status,
    verdict: a.verdict,
    decided_at: a.decided_at,
    approval_expired_at: a.approval_expired_at,
    reason: a.reason,
    action_type: a.action_type,
    activity_type: a.activity_type,
  });
}
