import { W as WorkflowVerdict } from '../govern-CX11GBkl.js';
export { A as ActivityStage, i as AgentIdentityConfig, j as AirflowSession, k as ArgocdSession, l as AutogenSession, B as BaseGovernedSession, m as BehavioralResult, n as CANONICAL_ACTIVITY_LABELS, o as CANONICAL_ACTIVITY_TYPES, q as CANONICAL_EVENT_TYPES, C as CanonicalEventType, a as CanonicalVerdict, r as ClaudeCodeSession, s as ClineSession, t as CodexSession, u as CopilotSession, b as CoreApiError, c as CoreClientConfig, v as CrewaiSession, w as CursorSession, x as CustomSession, D as DefaultSession, G as GovernedPayload, d as GovernedSessionConfig, y as GuardrailFieldVerdict, z as GuardrailReasonRef, E as GuardrailsVerdict, L as LangchainSession, F as LanggraphSession, H as LlamaindexSession, M as MastraSession, I as ModernTreasurySession, N as N8nSession, O as OpenBoxCoreClient, P as PRESET_MANIFEST, J as PagerdutySession, e as PresetCtor, f as PresetName, g as Presets, K as PydanticAiSession, Q as SemanticKernelSession, S as SessionAlreadyTerminatedError, T as TemporalSession, R as VercelAiSession, V as VerdictArm, h as govern, p as presets, U as signAgentIdentityRequest } from '../govern-CX11GBkl.js';
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
