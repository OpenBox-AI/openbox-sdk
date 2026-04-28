export { OpenBoxCoreClient, CoreApiError } from './core-client.js';
export type { CoreClientConfig } from './core-client.js';
export type {
  EventType,
  Verdict,
  LegacyAction,
  CoreError,
  AgentValidationResponse,
  ErrorInfo,
  GovernanceEventPayload,
  SpanData,
  SpanStatus,
  SpanEvent,
  GuardrailFieldResult,
  GuardrailReason,
  GuardrailsResult,
  GuardrailsVerdictResult,
  AGEAlignmentResult,
  AGETrustScore,
  AGESpanResult,
  AGEResult,
  GovernanceVerdictResponse,
  ApprovalStatusRequest,
  ApprovalStatusResponse,
} from './core-client.js';
export type { BehavioralResult } from './core-client.js';

// Spec-driven workflow runtime. Every preset Session class + the
// `govern()` helper + the `presets` registry is generated from
// specs/typespec/govern/main.tsp - adding a new preset or method in
// the spec flows directly through the codegen pipeline without a code
// edit on this side.
//
// `export *` surfaces every generated value/type, including the 22
// `<Preset>Session` classes (ClaudeCodeSession, CursorSession,
// LangchainSession, ...) so runtime-adapter consumers can write the
// type explicitly on handler signatures.
export * from './generated/govern.js';

// Guardrail redaction helpers - apply `verdict.guardrailsResult.redactedInput`
// over the original payload to forward a safe version downstream. Ported
// from openbox-sdk; adapted to the new camelCase verdict shape.
export {
  applyInputRedaction,
  applyOutputRedaction,
  deepUpdateObject,
} from './redaction.js';

// Spec-driven hook-protocol adapters live one folder out at
// `runtime/claude-code/` and `runtime/cursor/`. Import them via the
// public sub-paths `openbox-sdk/runtime/claude-code` /
// `openbox-sdk/runtime/cursor` - NOT from `openbox-sdk/core-client`.
// This re-export was removed to keep the core-client surface focused
// on wire types + clients.
