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

// Spec-driven workflow runtime. The entire `GovernedSession` class +
// `govern()` helper is generated from specs/typespec/govern/main.tsp
// - adding/removing/renaming activities in the spec flows directly
// through the codegen pipeline without a code edit on this side.
export {
  govern,
  GovernedSession,
  ACTIVITY_MANIFEST,
} from './generated/govern.js';
export type {
  GovernedAgent,
  GovernedSessionConfig,
  WorkflowVerdict,
  VerdictArm,
  GovernedPayload,
  ActivityName,
  CanonicalVerdict,
  ActivityManifestEntry,
} from './generated/govern.js';
