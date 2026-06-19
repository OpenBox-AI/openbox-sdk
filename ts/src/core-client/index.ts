// Public surface of `@openbox-ai/openbox-sdk/core-client`. Re-exports are kept
// explicit (no `export *`) so the file doubles as the inventory of
// what's intended for consumers; adding a new preset to the spec
// surfaces here as a one-line edit, not a silent leak.

export {
  OpenBoxCoreClient,
  CoreApiError,
  signAgentIdentityRequest,
  validateAgentIdentityConfig,
} from './core-client.js';
export type {
  AgentIdentityConfig,
  ApprovalStatusResponseWithClientExpiry,
  CoreClientConfig,
} from './core-client.js';
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
  BehavioralResult,
} from './core-client.js';

// ─── Spec-driven workflow runtime (specs/typespec/govern/main.tsp) ───
// govern() / presets / preset Session classes are generated. Adding a
// new preset = one new line in the manifest below + one new class
// re-export. Anything generated but NOT listed here is internal.

// Core types + verdict shape
export type {
  CanonicalEventType,
  ActivityStage,
  VerdictArm,
  GuardrailFieldVerdict,
  GuardrailReasonRef,
  GuardrailsVerdict,
  WorkflowVerdict,
  GovernedPayload,
  CanonicalVerdict,
} from './generated/govern.js';

// Manifest + base session
export {
  PRESET_MANIFEST,
  BaseGovernedSession,
  SessionAlreadyTerminatedError,
} from './generated/govern.js';
export type {
  PresetName,
  GovernedSessionConfig,
} from './generated/govern.js';

// Preset Session classes (one per @preset in the spec). Mappers in
// runtime/<adapter>/mappers/ pull these to type their handler params.
export {
  AirflowSession,
  AnthropicAgentSdkSession,
  ArgocdSession,
  AutogenSession,
  ClaudeCodeSession,
  ClineSession,
  CodexSession,
  CopilotSession,
  CrewaiSession,
  CursorSession,
  CustomSession,
  DefaultSession,
  LangchainSession,
  LanggraphSession,
  LlamaindexSession,
  MastraSession,
  ModernTreasurySession,
  N8nSession,
  OpenaiAgentsSdkSession,
  PagerdutySession,
  PydanticAiSession,
  SemanticKernelSession,
  TemporalSession,
  VercelAiSession,
} from './generated/govern.js';

// Workflow entry point + preset registry
export { govern, presets } from './generated/govern.js';
export type { Presets, PresetCtor } from './generated/govern.js';

// Canonical activity_type vocabulary + spec-driven display labels.
// Single source of truth for any UI rendering activity_types; mobile,
// web dashboard, CLI list views, audit reports. Consumers fall back to
// a Title-Case formatter for activity_types not in the labels table.
export {
  CANONICAL_EVENT_TYPE,
  CANONICAL_EVENT_TYPES,
  CANONICAL_ACTIVITY_TYPES,
  CANONICAL_ACTIVITY_LABELS,
  PRESET_ACTIVITY_TYPES,
} from './generated/govern.js';

// Guardrail redaction helpers; apply `verdict.guardrailsResult.redactedInput`
// over the original payload to forward a safe version downstream.
export {
  applyInputRedaction,
  applyOutputRedaction,
  deepUpdateObject,
  hasGuardrailRedaction,
  summarizeGuardrailRedaction,
} from './redaction.js';

// Spec-driven hook-protocol adapters live one folder out at
// `runtime/claude-code/` and `runtime/cursor/`. Import them via the
// public sub-paths `@openbox-ai/openbox-sdk/runtime/claude-code` /
// `@openbox-ai/openbox-sdk/runtime/cursor`; NOT from `@openbox-ai/openbox-sdk/core-client`.
