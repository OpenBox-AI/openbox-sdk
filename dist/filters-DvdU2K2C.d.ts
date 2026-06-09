import { c as Approval } from './responses-C2s9PwZF.js';

type DateRangeKey = 'today' | 'week' | 'month' | 'all';
interface FilterState {
    search?: string;
    tier?: string;
    activityType?: string;
    teamId?: string;
    ownerId?: string;
    sort: 'newest' | 'oldest';
    status?: 'approved' | 'rejected' | 'expired';
    dateRange?: DateRangeKey;
}
declare const EMPTY_FILTERS: FilterState;
declare function hasActiveFilters(f: FilterState): boolean;
interface SummaryLookups {
    teamName?: (id: string) => string | undefined;
    ownerName?: (id: string) => string | undefined;
}
declare function summarizeFilters(f: FilterState, lookups?: SummaryLookups): string | undefined;
declare function dateRangeBounds(key: DateRangeKey | undefined): {
    fromTime?: string;
    toTime?: string;
};
declare function applyClientFilters(approvals: Approval[], filters: FilterState, agentOwnerLookup: (agentId: string) => string | undefined): Approval[];

export { type DateRangeKey as D, EMPTY_FILTERS as E, type FilterState as F, type SummaryLookups as S, applyClientFilters as a, dateRangeBounds as d, hasActiveFilters as h, summarizeFilters as s };
