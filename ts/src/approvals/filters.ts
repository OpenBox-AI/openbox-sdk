// Filter state for approval list views.
//
// Server-side params (search, tiers, team_ids, activity_types, fromTime,
// toTime) ship to the backend's getOrgApprovals; sort + owner are
// client-side because owner needs the agent's owner_id which isn't on
// the approvals payload, and sort is cheap on a polled page.
//
// Persistence (e.g. VS Code memento, AsyncStorage) is the consumer's
// job; this module only owns the shape and the pure transforms.

import type { Approval } from '../types/index.js';

export type DateRangeKey = 'today' | 'week' | 'month' | 'all';

export interface FilterState {
  search?: string;
  tier?: string;
  activityType?: string;
  teamId?: string;
  ownerId?: string;
  sort: 'newest' | 'oldest';
  // history-only; ignored by the pending feed (status is pinned to
  // "pending" for that view).
  status?: 'approved' | 'rejected' | 'expired';
  dateRange?: DateRangeKey;
}

export const EMPTY_FILTERS: FilterState = { sort: 'newest', dateRange: 'all' };

export function hasActiveFilters(f: FilterState): boolean {
  return !!(
    f.search ||
    f.tier ||
    f.activityType ||
    f.teamId ||
    f.ownerId ||
    (f.dateRange && f.dateRange !== 'all')
  );
}

const DATE_RANGE_LABEL: Record<DateRangeKey, string> = {
  today: 'Today',
  week: 'Last 7 days',
  month: 'Last 30 days',
  all: 'All time',
};

export interface SummaryLookups {
  teamName?: (id: string) => string | undefined;
  ownerName?: (id: string) => string | undefined;
}

export function summarizeFilters(
  f: FilterState,
  lookups: SummaryLookups = {},
): string | undefined {
  const parts: string[] = [];
  if (f.search) parts.push(`"${f.search}"`);
  if (f.tier) parts.push(`Tier ${f.tier}`);
  if (f.activityType) parts.push(f.activityType);
  if (f.teamId) {
    const n = lookups.teamName?.(f.teamId);
    parts.push(`Team: ${n || f.teamId}`);
  }
  if (f.ownerId) {
    const n = lookups.ownerName?.(f.ownerId);
    parts.push(`Owner: ${n || f.ownerId}`);
  }
  if (f.dateRange && f.dateRange !== 'all') parts.push(DATE_RANGE_LABEL[f.dateRange]);
  return parts.length ? `Filters: ${parts.join(' · ')}` : undefined;
}

export function dateRangeBounds(
  key: DateRangeKey | undefined,
): { fromTime?: string; toTime?: string } {
  if (!key || key === 'all') return {};
  const now = new Date();
  const end = now.toISOString();
  const start = new Date(now);
  if (key === 'today') start.setHours(0, 0, 0, 0);
  else if (key === 'week') start.setDate(start.getDate() - 7);
  else if (key === 'month') start.setDate(start.getDate() - 30);
  return { fromTime: start.toISOString(), toTime: end };
}

export function applyClientFilters(
  approvals: Approval[],
  filters: FilterState,
  agentOwnerLookup: (agentId: string) => string | undefined,
): Approval[] {
  let out = approvals;
  if (filters.ownerId) {
    out = out.filter((a) => {
      const owner = a.agent_id ? agentOwnerLookup(a.agent_id) : undefined;
      return owner === filters.ownerId;
    });
  }
  // activity_type: server-side filter is gated on a backend proposal;
  // until that lands, filter client-side as a belt-and-suspenders so
  // the UI always reflects the chip even if the server ignored the
  // param. `action_type` is the canonical wire field; `activity_type`
  // is its legacy alias and both ride together.
  if (filters.activityType) {
    out = out.filter((a) => (a.action_type || a.activity_type) === filters.activityType);
  }
  if (filters.sort === 'oldest') {
    out = [...out].sort(
      (a, b) => Date.parse(a.created_at || '') - Date.parse(b.created_at || ''),
    );
  } else {
    out = [...out].sort(
      (a, b) => Date.parse(b.created_at || '') - Date.parse(a.created_at || ''),
    );
  }
  return out;
}
