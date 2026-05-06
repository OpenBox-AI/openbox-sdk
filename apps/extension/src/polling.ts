import { EventEmitter } from "events";
import type { OpenBoxClient } from "openbox-sdk/client";
import type { Approval } from "./types";
import type { FilterState } from "./filters";
import { dateRangeBounds } from "./filters";

const DEFAULT_POLL_INTERVAL = 5000;
const PAGE_SIZE = 50;
const MAX_PAGES = 5;

type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

// Driven by extension.ts. We don't read env or token state here; the
// OpenBoxClient passed in already knows its env and handles auth/headers.
export class PollingService extends EventEmitter {
  private client: OpenBoxClient;
  private orgId: string;
  private status: ApprovalStatus | undefined;
  private pollMs: number;
  private filters: FilterState = { sort: "newest", dateRange: "all" };
  private knownIds = new Set<string>();
  // Mobile uses cursor pagination via useApprovals; the extension takes
  // a simpler shape: each poll re-fetches page 0 with perPage = PAGE_SIZE
  // * loadedPages. loadMore() increments loadedPages and re-polls. The
  // network cost stays bounded (PAGE_SIZE * MAX_PAGES = 250 rows max);
  // load-more progress survives polls because perPage stays grown.
  private loadedPages = 1;
  // First successful poll is "seeding"; spurious newApprovals toasts on
  // cold load violate VS Code's notification UX guidelines ("do not
  // send repeated notifications"). After seed, deltas are real arrivals.
  private seeded = false;
  // True when the next poll is a load-more (paging deeper into the
  // backlog). The page-N rows aren't "new arrivals" — they were always
  // there, we just hadn't asked for them — so newApprovals must not
  // fire for that poll. Reset after the suppressed poll.
  private suppressNextBatch = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private _approvals: Approval[] = [];
  private _hasMore = false;
  // Lightweight telemetry surfaced by the debug panel. Public so
  // extension.ts can build a snapshot without the panel knowing about
  // each PollingService instance.
  lastPollAt: number | undefined;
  lastErrorAt: number | undefined;
  lastErrorMessage: string | undefined;
  errorCount = 0;

  constructor(
    client: OpenBoxClient,
    orgId: string,
    options: {
      status?: ApprovalStatus;
      pollMs?: number;
      filters?: FilterState;
    } = {},
  ) {
    super();
    this.client = client;
    this.orgId = orgId;
    this.status = options.status;
    this.pollMs = options.pollMs ?? DEFAULT_POLL_INTERVAL;
    if (options.filters) this.filters = options.filters;
  }

  get approvals(): Approval[] { return this._approvals; }
  get hasMore(): boolean { return this._hasMore; }
  get atPageLimit(): boolean { return this.loadedPages >= MAX_PAGES; }

  start() {
    this.emit("changed", []);
    this.poll();
    this.timer = setInterval(() => this.poll(), this.pollMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async refresh() {
    await this.poll();
  }

  // Filter / status / loadMore all reset the seed gate AND knownIds:
  // post-change rows aren't "new arrivals" relative to the prior state,
  // they're a different slice of the same backlog. Without the reset,
  // switching from Tier 4 to Tier 2 would toast every Tier 2 row as if
  // it just landed.
  setFilters(filters: FilterState) {
    this.filters = filters;
    this.loadedPages = 1;
    this.knownIds.clear();
    this.seeded = false;
    void this.poll();
  }

  setStatus(status: ApprovalStatus | undefined) {
    this.status = status;
    this.loadedPages = 1;
    this.knownIds.clear();
    this.seeded = false;
    void this.poll();
  }

  loadMore() {
    if (this.atPageLimit) return;
    this.loadedPages += 1;
    // The page-N rows aren't "new arrivals" — they were always in the
    // backlog, we just hadn't asked for them — so newApprovals must
    // not fire for the very next poll.
    this.suppressNextBatch = true;
    void this.poll();
  }

  private async poll() {
    try {
      const { fromTime, toTime } = dateRangeBounds(this.filters.dateRange);
      const perPage = PAGE_SIZE * this.loadedPages;
      // Server-side filter params; activity_types is silently ignored
      // by the backend until proposal/approvals-activity-type-filter
      // ships, so filters.ts also re-applies it client-side.
      const result = await this.client.getOrgApprovals(this.orgId, {
        status: this.status,
        page: 0,
        perPage,
        search: this.filters.search,
        tiers: this.filters.tier ? [this.filters.tier] : undefined,
        activity_types: this.filters.activityType ? [this.filters.activityType] : undefined,
        team_ids: this.filters.teamId ? [this.filters.teamId] : undefined,
        fromTime,
        toTime,
      });
      const approvals = result.approvals?.data ?? [];
      const newIds = new Set(approvals.map((a) => a.id));

      const brandNew = approvals.filter((a) => !this.knownIds.has(a.id));
      const changed =
        this.knownIds.size !== newIds.size ||
        [...newIds].some((id) => !this.knownIds.has(id));

      this.knownIds = newIds;
      this._approvals = approvals;
      // "Has more" = the page came back full. Off-by-one when total is
      // an exact multiple of perPage (last load-more click yields zero
      // new rows); harmless extra click.
      this._hasMore = !this.atPageLimit && approvals.length >= perPage;

      const shouldToast = this.seeded && !this.suppressNextBatch && brandNew.length > 0;
      if (shouldToast) {
        this.emit("newApprovals", brandNew);
      }
      if (changed || !this.seeded) {
        this.emit("changed", approvals);
      }
      this.seeded = true;
      this.suppressNextBatch = false;
      this.lastPollAt = Date.now();
    } catch (err: any) {
      this.errorCount += 1;
      this.lastErrorAt = Date.now();
      this.lastErrorMessage = err?.message ? String(err.message) : String(err);
      this.emit("error", err);
    }
  }
}
