// Memento-backed persistence for the filter state. The state shape,
// date-range bounds, summary formatting, and client-side application
// all live in `@openbox-ai/openbox-sdk/approvals` (one source of truth across the
// SDK and downstream consumers); the extension only owns the
// per-target / per-scope storage namespacing because Memento isn't
// available outside the editor host.

import * as vscode from "vscode";
import { EMPTY_FILTERS, type FilterState } from "@openbox-ai/openbox-sdk/approvals";

export {
  EMPTY_FILTERS,
  applyClientFilters,
  dateRangeBounds,
  hasActiveFilters,
  summarizeFilters,
} from "@openbox-ai/openbox-sdk/approvals";
export type { DateRangeKey, FilterState, SectionStatus } from "@openbox-ai/openbox-sdk/approvals";

function key(scope: string, targetKey: string): string {
  // Per-target namespace so team and owner IDs from different deployments
  // don't collide. Per-scope
  // ('pending' / 'history') because the two views carry independent
  // filter sets in mobile, and the extension keeps that parity.
  return `openbox.filters.${scope}.${targetKey}`;
}

export function loadFilters(state: vscode.Memento, scope: string, targetKey: string): FilterState {
  const stored = state.get<FilterState>(key(scope, targetKey));
  if (!stored) return { ...EMPTY_FILTERS };
  const status =
    scope === "history" &&
    (stored.status === "approved" ||
      stored.status === "rejected" ||
      stored.status === "expired")
      ? stored.status
      : undefined;
  return {
    sort: stored.sort === "oldest" ? "oldest" : "newest",
    search: stored.search || undefined,
    tier: stored.tier || undefined,
    activityType: stored.activityType || undefined,
    teamId: stored.teamId || undefined,
    ownerId: stored.ownerId || undefined,
    status,
    dateRange: stored.dateRange || "all",
  };
}

export function saveFilters(
  state: vscode.Memento,
  scope: string,
  targetKey: string,
  filters: FilterState,
): Thenable<void> {
  return state.update(key(scope, targetKey), filters);
}
