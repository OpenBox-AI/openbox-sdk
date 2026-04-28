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
