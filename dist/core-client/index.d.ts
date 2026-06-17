export { A as AgentIdentityConfig, B as BehavioralResult, C as CoreApiError, a as CoreClientConfig, O as OpenBoxCoreClient, s as signAgentIdentityRequest } from '../core-client-BaOdHXQU.js';
import { W as WorkflowVerdict } from '../govern-BdX8nYkt.js';
export { A as ActivityStage, f as AirflowSession, h as ArgocdSession, i as AutogenSession, B as BaseGovernedSession, j as CANONICAL_ACTIVITY_LABELS, k as CANONICAL_ACTIVITY_TYPES, l as CANONICAL_EVENT_TYPES, C as CanonicalEventType, a as CanonicalVerdict, m as ClaudeCodeSession, n as ClineSession, o as CodexSession, q as CopilotSession, r as CrewaiSession, s as CursorSession, t as CustomSession, D as DefaultSession, G as GovernedPayload, b as GovernedSessionConfig, u as GuardrailFieldVerdict, v as GuardrailReasonRef, w as GuardrailsVerdict, L as LangchainSession, x as LanggraphSession, y as LlamaindexSession, M as MastraSession, z as ModernTreasurySession, N as N8nSession, P as PRESET_MANIFEST, E as PagerdutySession, c as PresetCtor, d as PresetName, e as Presets, F as PydanticAiSession, H as SemanticKernelSession, S as SessionAlreadyTerminatedError, T as TemporalSession, I as VercelAiSession, V as VerdictArm, g as govern, p as presets } from '../govern-BdX8nYkt.js';
export { b as AGEAlignmentResult, c as AGEResult, d as AGESpanResult, e as AGETrustScore, f as AgentValidationResponse, A as ApprovalStatusRequest, a as ApprovalStatusResponse, C as CoreError, E as ErrorInfo, g as EventType, G as GovernanceEventPayload, h as GovernanceVerdictResponse, i as GuardrailFieldResult, j as GuardrailReason, k as GuardrailsResult, l as GuardrailsVerdictResult, L as LegacyAction, S as SpanData, m as SpanEvent, n as SpanStatus, V as Verdict } from '../core-types-Dxgkbox0.js';

type GuardrailsVerdict = NonNullable<WorkflowVerdict['guardrailsResult']>;
/**
 * Recursively merge `source` fields into `target`. Plain objects are
 * deep-merged; arrays of objects are merged by index so partial
 * guardrail transforms do not drop sibling fields. Mutates `target`.
 */
declare function deepUpdateObject(target: unknown, source: Record<string, unknown>): void;
/**
 * Apply core's `redactedInput` over the ORIGINAL activity input. Returns
 * a redacted copy you can forward downstream. No-op when the verdict
 * isn't an activity-input redaction (input_type !== "activity_input")
 * or when there's no redaction to apply.
 */
declare function applyInputRedaction<T = unknown>(originalData: T, guardrails: GuardrailsVerdict | undefined): T;
/**
 * Apply core's `redactedInput` over the ORIGINAL activity output. Same
 * deep-merge logic but keyed on `inputType === "activity_output"` (the
 * verdict shape doesn't rename "input"-side state for output redactions).
 */
declare function applyOutputRedaction<T = unknown>(originalOutput: T, guardrails: GuardrailsVerdict | undefined): T;
declare function hasGuardrailRedaction(guardrails: GuardrailsVerdict | undefined): boolean;
declare function summarizeGuardrailRedaction(guardrails: GuardrailsVerdict | undefined, fallback?: string): string;

export { WorkflowVerdict, applyInputRedaction, applyOutputRedaction, deepUpdateObject, hasGuardrailRedaction, summarizeGuardrailRedaction };
