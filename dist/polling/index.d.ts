import { EventEmitter } from 'events';
import { b as OpenBoxClient } from '../client-D20fgzve.js';
import { c as Approval } from '../responses-C2s9PwZF.js';
import { F as FilterState } from '../filters-DvdU2K2C.js';
import '../env-bindings--BxVwc6f.js';

type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';
interface PollingOptions {
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
declare class ApprovalsPollingService extends EventEmitter {
    private client;
    private orgId;
    private intervalMs;
    private perPage;
    private maxPages;
    private status;
    private filters;
    private sourceFilter;
    private strictSourceFilter;
    private knownIds;
    private loadedPages;
    private seeded;
    private suppressNextBatch;
    private timer;
    private _approvals;
    private lastFingerprints;
    private _hasMore;
    lastPollAt: number | undefined;
    lastErrorAt: number | undefined;
    lastErrorMessage: string | undefined;
    errorCount: number;
    constructor(client: OpenBoxClient, orgId: string, options?: PollingOptions);
    get approvals(): Approval[];
    get hasMore(): boolean;
    get atPageLimit(): boolean;
    get pageSize(): number;
    start(): void;
    stop(): void;
    refresh(): Promise<void>;
    setFilters(filters: FilterState): void;
    setStatus(status: ApprovalStatus | undefined): void;
    setPageSize(perPage: number): void;
    loadMore(): void;
    private poll;
}

export { type ApprovalStatus, ApprovalsPollingService, type PollingOptions };
