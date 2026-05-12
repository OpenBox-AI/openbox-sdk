// Shared, platform-agnostic helpers for approvals.
//
//   import { formatLabel, summarizeInput, statusOf } from 'openbox-sdk/approvals';
//
// Rendering helpers are pure functions with no React, React Native,
// Expo, VS Code, or other platform-runtime imports. Consumers
// compose them with their own view layer.
//
// The unix-domain-socket client (`connectApprovalSocket`) and the
// matching server (`ApprovalSocketServer`) live here so any host
// integration can wire either side without re-implementing the
// wire format.
//
// Mocks live under `openbox-sdk/approvals/mocks` so a production
// bundle can drop them entirely.

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
export {
  connectApprovalSocket,
  APPROVAL_SOCKET_PATH,
  type PendingNotification,
  type SocketResult,
} from './socket-client.js';
export {
  ApprovalSocketServer,
  type ApprovalPendingMessage,
  type ApprovalServerConnection,
  type ApprovalSocketServerOptions,
  type ApprovalSocketServerHandlers,
} from './socket-server.js';
export {
  decideApproval,
  resolveApprovalIdentity,
  ApprovalIdentityNotFoundError,
  type ApprovalIdentityHint,
  type ResolvedApprovalIdentity,
} from './resolve.js';
export { approvalSource, type ApprovalSource } from './source.js';
