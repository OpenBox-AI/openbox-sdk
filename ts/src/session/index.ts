// Public sub-path: `openbox-sdk/session`.
//
// Disk-backed mapping from a session key to a `workflowId` and
// `runId`. Used by every runtime adapter to keep its session record
// stable across hook subprocesses.

export {
  resolveSessionByKey,
  peekSessionByKey,
  markHaltedByKey,
  clearSessionByKey,
  type SharedSessionConfig,
} from './resolver.js';
export { SessionStore } from './store.js';
