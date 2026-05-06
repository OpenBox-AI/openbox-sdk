// Memento-backed persistence for the filter state. The state shape,
// date-range bounds, summary formatting, and client-side application
// all live in `openbox-sdk/approvals` (one source of truth across the
// SDK and downstream consumers); the extension only owns the
// per-env / per-scope storage namespacing because Memento isn't
// available outside the editor host.

import * as vscode from "vscode";
import { EMPTY_FILTERS, type FilterState } from "openbox-sdk/approvals";

export {
  EMPTY_FILTERS,
  applyClientFilters,
  dateRangeBounds,
  hasActiveFilters,
  summarizeFilters,
} from "openbox-sdk/approvals";
export type { DateRangeKey, FilterState, SectionStatus } from "openbox-sdk/approvals";

function key(scope: string, env: string): string {
  // Per-env namespace so prod / staging / local don't collide; team
  // and owner IDs in particular aren't portable across envs. Per-scope
  // ('pending' / 'history') because the two views carry independent
  // filter sets in mobile, and the extension keeps that parity.
  return `openbox.filters.${scope}.${env}`;
}

export function loadFilters(state: vscode.Memento, scope: string, env: string): FilterState {
  const stored = state.get<FilterState>(key(scope, env));
  if (!stored) return { ...EMPTY_FILTERS };
  return {
    sort: stored.sort === "oldest" ? "oldest" : "newest",
    search: stored.search || undefined,
    tier: stored.tier || undefined,
    activityType: stored.activityType || undefined,
    teamId: stored.teamId || undefined,
    ownerId: stored.ownerId || undefined,
    status: stored.status || undefined,
    dateRange: stored.dateRange || "all",
  };
}

export function saveFilters(
  state: vscode.Memento,
  scope: string,
  env: string,
  filters: FilterState,
): Thenable<void> {
  return state.update(key(scope, env), filters);
}
