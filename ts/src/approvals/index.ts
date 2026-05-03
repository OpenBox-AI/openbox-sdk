// Shared, platform-agnostic helpers for rendering approval rows.
//
//   import { formatLabel, summarizeInput, statusOf } from 'openbox-sdk/approvals';
//
// Pure functions only; no React, React Native, Expo, VS Code, or other
// platform-runtime imports. Consumers compose these with their own
// style / view layer.
//
// Mocks live at the `openbox-sdk/approvals/mocks` sub-path so a
// production bundle can drop them entirely.

export { formatLabel, verdictLabel, UPPERCASE_WORDS } from './format.js';
export { summarizeInput } from './summarize.js';
export { statusOf, type SectionStatus, type ApprovalBucket } from './status.js';
export { tierColor, tierBg } from './tier.js';
export { timeAgo, timeRemaining } from './time.js';
export {
  type FilterState,
  type DateRangeKey,
  type SummaryLookups,
  EMPTY_FILTERS,
  applyClientFilters,
  dateRangeBounds,
  hasActiveFilters,
  summarizeFilters,
} from './filters.js';
