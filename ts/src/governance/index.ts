// Public sub-path: `@openbox-ai/openbox-sdk/governance`.
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
//   * `REDACT_PATH_CONTENT_PATTERNS`, `shouldRedactPathContent`, and
//     `isInsideAnyRoot` identify IDE metadata / secret paths whose raw
//     content should stay out of governance payloads.
//   * `fetchRulesProjection` returns a Cursor-compatible projection
//     of an agent's behavior rules.
//   * `hookEventLabel` / `HOOK_EVENT_LABELS` map hook event names to
//     human-readable display strings.

export {
  checkGovernance,
  type CheckGovernanceOptions,
  type SpanType,
} from './check.js';
export {
  buildLLMCompletionResponseBody,
  buildLLMCompletionSpan,
  buildSpan,
  type LLMCompletionSpanInput,
  type SpanInput,
} from './spans.js';
export { EVENT } from './events.js';
export {
  REDACT_PATH_CONTENT_PATTERNS,
  shouldRedactPathContent,
  isSensitivePath,
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
