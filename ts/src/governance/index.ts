// Public sub-path: `openbox-sdk/governance`.
//
// Cross-cutting governance primitives that any SDK consumer can
// reuse:
//
//   * `checkGovernance` runs an in-process evaluation against the
//     core endpoint. Suitable for gates, ad-hoc audits, and tests.
//   * `buildSpan` constructs a classifier-ready span with the
//     `semantic_type` and gate attributes the policy engine needs
//     to match behavior rules.
//   * `EVENT` enumerates the canonical workflow event names
//     (`ActivityStarted`, `ActivityCompleted`, `SignalReceived`).
//   * `SKIP_PATTERNS`, `isSkipped`, and `isInsideAnyRoot` identify
//     IDE metadata paths (`.git`, `.claude`, `.ssh`, etc.) that
//     should bypass governance.
//   * `fetchRulesProjection` returns a Cursor-compatible projection
//     of an agent's behavior rules.
//   * `hookEventLabel` / `HOOK_EVENT_LABELS` map hook event names to
//     human-readable display strings.

export {
  checkGovernance,
  type CheckGovernanceOptions,
  type SpanType,
} from './check.js';
export { buildSpan, type SpanInput } from './spans.js';
export { EVENT } from './events.js';
export {
  SKIP_PATTERNS,
  isSkipped,
  isInsideAnyRoot,
} from './skip-patterns.js';
export {
  fetchRulesProjection,
  type ProjectedRule,
  type RulesProjection,
  type RuleTrigger,
  type RuleSeverity,
  type FetchProjectionOpts,
} from './rules-projection.js';
export { hookEventLabel, HOOK_EVENT_LABELS } from './hook-event-labels.js';
