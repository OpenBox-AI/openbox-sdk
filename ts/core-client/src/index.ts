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
export {
  govern,
  presets,
  PRESET_MANIFEST,
  BaseGovernedSession,
  SessionAlreadyTerminatedError,
} from './generated/govern.js';
export type {
  Presets,
  PresetCtor,
  PresetName,
  GovernedSessionConfig,
  WorkflowVerdict,
  VerdictArm,
  GovernedPayload,
  ActivityStage,
  CanonicalEventType,
  CanonicalVerdict,
} from './generated/govern.js';

// Spec-driven hook-protocol adapters. One generated module per
// @adapter interface in specs/typespec/govern/adapters.tsp. Consumed
// by openbox-claude-hooks / openbox-cursor-hooks via the
// `openbox-sdk/runtime/<name>` sub-path on the public bundle.
export {
  createClaudeHooksAdapter,
  type ClaudeHookEnvelope,
  type ClaudeHooksAdapterConfig,
  type ClaudeHooksAdapterHandlers,
} from './generated/runtime/claude-hooks.js';
export {
  createCursorHooksAdapter,
  type CursorHookEnvelope,
  type CursorHooksAdapterConfig,
  type CursorHooksAdapterHandlers,
} from './generated/runtime/cursor-hooks.js';
