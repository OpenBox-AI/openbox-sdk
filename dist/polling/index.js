// ts/src/polling/index.ts
import { EventEmitter } from "events";

// ts/src/approvals/filters.ts
function dateRangeBounds(key) {
  if (!key || key === "all") return {};
  const now = /* @__PURE__ */ new Date();
  const end = now.toISOString();
  const start = new Date(now);
  if (key === "today") start.setHours(0, 0, 0, 0);
  else if (key === "week") start.setDate(start.getDate() - 7);
  else if (key === "month") start.setDate(start.getDate() - 30);
  return { fromTime: start.toISOString(), toTime: end };
}

// ts/src/approvals/source.ts
var SOURCE_INPUT_KEY = "_openbox_source";
function readMetadataSource(a) {
  const meta = a.metadata;
  if (!meta || typeof meta !== "object") return void 0;
  const src = meta.source;
  return typeof src === "string" && src.length > 0 ? src : void 0;
}
function readInputSource(a) {
  const input = a.input;
  if (!Array.isArray(input) || input.length === 0) return void 0;
  const head = input[0];
  if (!head || typeof head !== "object") return void 0;
  const src = head[SOURCE_INPUT_KEY];
  return typeof src === "string" && src.length > 0 ? src : void 0;
}
function readSpanModule(a) {
  const spans = a.spans;
  if (!Array.isArray(spans) || spans.length === 0) return void 0;
  const span = spans[0];
  if (!span || typeof span !== "object") return void 0;
  const s = span;
  if (typeof s.module === "string" && s.module.length > 0) return s.module;
  const attrs = s.attributes;
  if (attrs && typeof attrs === "object") {
    const sys = attrs["gen_ai.system"];
    if (typeof sys === "string" && sys.length > 0) return sys;
  }
  return void 0;
}
function approvalSource(a) {
  return readMetadataSource(a) ?? readInputSource(a) ?? readSpanModule(a);
}

// ts/src/polling/index.ts
var DEFAULT_INTERVAL_MS = 5e3;
var DEFAULT_PER_PAGE = 50;
var DEFAULT_MAX_PAGES = 5;
var DEFAULT_STATUS = "pending";
var ApprovalsPollingService = class extends EventEmitter {
  client;
  orgId;
  intervalMs;
  perPage;
  maxPages;
  status;
  filters = { sort: "newest", dateRange: "all" };
  sourceFilter;
  strictSourceFilter = false;
  knownIds = /* @__PURE__ */ new Set();
  // Each poll re-fetches page 0 with `perPage = base * loadedPages`.
  // Network cost stays bounded (`perPage * maxPages` is 250 rows by
  // default); load-more progress survives polls because `perPage`
  // remains grown.
  loadedPages = 1;
  // The first successful poll is a seeding round. Firing
  // `newApprovals` for the entire initial set would violate the VS
  // Code notification guideline against repeated notifications, so
  // the first delta is suppressed. After seeding, deltas represent
  // real arrivals.
  seeded = false;
  // Set when the next poll is a load-more (paging deeper into the
  // backlog). The newly-paged rows were already on the backend; the
  // change is in the consumer's request, not in the underlying
  // data, so `newApprovals` must not fire for that poll. Cleared
  // after the suppressed poll.
  suppressNextBatch = false;
  timer;
  _approvals = [];
  lastFingerprints = /* @__PURE__ */ new Map();
  _hasMore = false;
  // Lightweight telemetry. Public so consumers can build a snapshot
  // without the instance reaching back into them.
  lastPollAt;
  lastErrorAt;
  lastErrorMessage;
  errorCount = 0;
  constructor(client, orgId, options = {}) {
    super();
    this.client = client;
    this.orgId = orgId;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.perPage = options.perPage ?? DEFAULT_PER_PAGE;
    this.maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    this.status = "status" in options ? options.status : DEFAULT_STATUS;
    if (options.filters) this.filters = options.filters;
    this.sourceFilter = options.sourceFilter;
    this.strictSourceFilter = options.strictSourceFilter ?? false;
  }
  get approvals() {
    return this._approvals;
  }
  get hasMore() {
    return this._hasMore;
  }
  get atPageLimit() {
    return this.loadedPages >= this.maxPages;
  }
  get pageSize() {
    return this.perPage;
  }
  start() {
    this.emit("changed", []);
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
  }
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = void 0;
    }
  }
  async refresh() {
    await this.poll();
  }
  setFilters(filters) {
    this.filters = filters;
    this.loadedPages = 1;
    this.knownIds.clear();
    this.seeded = false;
    void this.poll();
  }
  setStatus(status) {
    this.status = status;
    this.loadedPages = 1;
    this.knownIds.clear();
    this.seeded = false;
    void this.poll();
  }
  setPageSize(perPage) {
    const normalized = Math.max(1, Math.floor(perPage));
    if (this.perPage === normalized) return;
    this.perPage = normalized;
    this.loadedPages = 1;
    this.knownIds.clear();
    this.seeded = false;
    void this.poll();
  }
  loadMore() {
    if (this.atPageLimit) return;
    this.loadedPages += 1;
    this.suppressNextBatch = true;
    void this.poll();
  }
  async poll() {
    try {
      const { fromTime, toTime } = dateRangeBounds(this.filters.dateRange);
      const perPage = this.perPage * this.loadedPages;
      const result = await this.client.getOrgApprovals(this.orgId, {
        status: this.status,
        page: 0,
        perPage,
        search: this.filters.search,
        tiers: this.filters.tier ? [this.filters.tier] : void 0,
        activity_types: this.filters.activityType ? [this.filters.activityType] : void 0,
        team_ids: this.filters.teamId ? [this.filters.teamId] : void 0,
        fromTime,
        toTime
      });
      const allApprovals = result.approvals?.data ?? [];
      const approvals = this.sourceFilter ? allApprovals.filter((a) => {
        const src = approvalSource(a);
        if (src === this.sourceFilter) return true;
        if (src === void 0) return !this.strictSourceFilter;
        return false;
      }) : allApprovals;
      const newFingerprints = new Map(
        approvals.map((a) => [a.id, approvalFingerprint(a)])
      );
      const brandNew = approvals.filter((a) => !this.knownIds.has(a.id));
      const changed = this.lastFingerprints.size !== newFingerprints.size || [...newFingerprints].some(
        ([id, fingerprint]) => this.lastFingerprints.get(id) !== fingerprint
      );
      this.knownIds = new Set(newFingerprints.keys());
      this.lastFingerprints = newFingerprints;
      this._approvals = approvals;
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
    } catch (err) {
      this.errorCount += 1;
      this.lastErrorAt = Date.now();
      this.lastErrorMessage = err && typeof err === "object" && "message" in err ? String(err.message) : String(err);
      this.emit("error", err);
    }
  }
};
function approvalFingerprint(a) {
  return JSON.stringify({
    id: a.id,
    status: a.status,
    verdict: a.verdict,
    decided_at: a.decided_at,
    approval_expired_at: a.approval_expired_at,
    reason: a.reason,
    action_type: a.action_type,
    activity_type: a.activity_type
  });
}
export {
  ApprovalsPollingService
};
