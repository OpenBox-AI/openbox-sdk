// specs/typespec/govern/main.tsp - language-agnostic shape of the
// governance protocol that wraps every governed agent action.
//
// THREE-TIER MODEL:
//
// Tier 1 (locked) - `CanonicalEventType`. Six values openbox-core
//   recognizes for guardrail eligibility, attestation extraction, and
//   metric routing (verified against internal/services/governance_workflow.go).
//   Lifecycle (Workflow{Started,Completed,Failed}) is SDK-internal -
//   the runtime fires it via try/finally + process-exit handlers, never
//   user code. So workflows can't hang in PENDING state.
//
// Tier 2 (presets) - one @preset interface per framework. Each method
//   maps to the canonical envelope via @maps_to(eventType, activityType).
//   Generated runtime exposes one Session class per preset. User picks
//   the preset that matches their framework; SDK does the right wrapping.
//
// Tier 3 (escape) - `default` (generic typed methods, framework-agnostic)
//   and `custom` (free-form `activity(name, stage, payload)` for domain
//   agents - FinOps, IAM, RPA, procurement - whose vocabularies don't
//   fit any framework).
//
// Note: programming-model spec, not an HTTP API. We deliberately do NOT
// mark this `@service` - the openapi3 emitter quietly skips non-service
// namespaces, which is what we want.

import "@openbox/typespec-workflow";

using OpenBox.Workflow;

namespace OpenboxGovern;

// ---------------------------------------------------------------------------
// Tier 1 - locked envelope
// ---------------------------------------------------------------------------

/**
 * Canonical event_type values openbox-core's runtime recognizes.
 * Custom strings are accepted by the wire (varchar(50), no whitelist)
 * but skip event-type-specific code paths - guardrails won't fire,
 * attestation won't extract, metrics route to a fallback.
 */
enum CanonicalEventType {
  WorkflowStarted: "WorkflowStarted",
  WorkflowCompleted: "WorkflowCompleted",
  WorkflowFailed: "WorkflowFailed",
  ActivityStarted: "ActivityStarted",
  ActivityCompleted: "ActivityCompleted",
  SignalReceived: "SignalReceived",
}

/** Stage prefix on guardrail field paths. "0" = start, "1" = complete. */
enum ActivityStage {
  pre: "pre",
  post: "post",
}

/** Four arms emitted by the live core. `constrain` is in the spec for
 *  forward compatibility but never appears on the wire today. */
enum VerdictArm {
  allow: "allow",
  constrain: "constrain",
  require_approval: "require_approval",
  block: "block",
  halt: "halt",
}

/**
 * Public-facing workflow verdict - what every preset method returns
 * to the caller. The runtime maps the wire `GovernanceVerdictResponse`
 * to this shape, promoting the arm into a structured payload alongside
 * risk/trust data and the approval-polling handle.
 */
/**
 * Per-field guardrail outcome. Mirrors core's GuardrailFieldResult.
 */
model GuardrailFieldVerdict {
  field: string;
  status: "allowed" | "blocked" | "redacted" | "skipped";
  reason?: string;
}

/**
 * Reason carrier on guardrail outcomes - same shape as core's
 * GuardrailReason, lifted here so consumers don't have to import
 * across the core/govern boundary.
 */
model GuardrailReasonRef {
  type: string;
  field?: string;
  reason: string;
}

/**
 * Verdict-time guardrails report. Surfaces the redacted-input payload
 * + reasons so adapters can apply DLP/redaction without breaking out
 * of the preset API. Populated by mapVerdict() from the wire response's
 * guardrails_result block.
 */
model GuardrailsVerdict {
  /** Which side of the activity the redaction applies to. */
  inputType: "activity_input" | "activity_output";

  /**
   * Redacted payload as decided by the guardrail service. Pass to
   * `applyInputRedaction(...)` / `applyOutputRedaction(...)` against
   * the original payload to forward a safe version downstream.
   */
  redactedInput?: unknown;

  /** False when any field result is `blocked`. */
  validationPassed: boolean;

  reasons: GuardrailReasonRef[];

  fieldResults: GuardrailFieldVerdict[];
}

@verdict
model WorkflowVerdict {
  arm: VerdictArm;

  /** Set on `require_approval`; opaque ID for the polling endpoint. */
  approvalId?: string;

  /** Wall-clock cutoff for `require_approval`; SDK stops polling after this. */
  approvalExpiresAt?: utcDateTime;

  /** Human-readable explanation when the arm isn't `allow`. */
  reason?: string;

  /** Aggregate risk score in [0, 1]. */
  riskScore: float64;

  /** Agent trust tier (1-4) at the moment of evaluation. */
  trustTier?: int32;

  /**
   * Guardrails outcome - populated when a guardrail fired (PII/safety/
   * content checks). `redactedInput` is the safe payload to forward
   * downstream; `reasons` and `fieldResults` describe what happened
   * per field. Adapters use this to apply redaction post-verdict
   * without parsing the raw wire response.
   */
  guardrailsResult?: GuardrailsVerdict;
}

/** Free-form input/output payload. Server stringifies; SDKs pass through. */
model GovernedPayload {
  /** Activity input (request side). Wrap singletons as a one-element array. */
  input?: unknown[];

  /** Activity output (response side); only set on completion events. */
  output?: unknown;
}

// ---------------------------------------------------------------------------
// Tier 2 - framework presets
//
// One @preset interface per framework. The emitter generates a
// `<PascalName>Session` class for each, with one method per operation
// that internally calls `runActivity(eventType, activityType, payload)`.
// Lifecycle (Workflow{Started,Completed,Failed}) is fired by the SDK
// runtime; presets never declare it.
//
// Streaming events (per-token chunks like LangChain `on_llm_new_token`,
// Vercel `onChunk` text-delta) are intentionally omitted - gating per
// token is rarely useful (can't redact mid-stream) and burns rate limit.
// The pattern is to aggregate the stream and emit one ActivityCompleted
// at end-of-stream. Custom callers can still emit per-token via the
// `custom` preset's free-form `activity()` if they need to.
// ---------------------------------------------------------------------------

// --- Coding agents --------------------------------------------------------

@preset("claude-code")
interface ClaudeCodePreset {
  @maps_to("ActivityStarted", "PreToolUse")
  preToolUse(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "PostToolUse")
  postToolUse(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "UserPromptSubmit")
  userPromptSubmit(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "PermissionRequest")
  permissionRequest(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "PreCompact")
  preCompact(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "SubagentStop")
  subagentStop(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "Notification")
  notification(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "Stop")
  stop(payload: GovernedPayload): WorkflowVerdict;
}

@preset("cursor")
interface CursorPreset {
  @maps_to("ActivityStarted", "beforeSubmitPrompt")
  beforeSubmitPrompt(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "preToolUse")
  preToolUse(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "postToolUse")
  postToolUse(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "beforeShellExecution")
  beforeShellExecution(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "afterShellExecution")
  afterShellExecution(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "beforeMCPExecution")
  beforeMCPExecution(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "afterMCPExecution")
  afterMCPExecution(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "beforeReadFile")
  beforeReadFile(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "afterFileEdit")
  afterFileEdit(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "afterAgentResponse")
  afterAgentResponse(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "afterAgentThought")
  afterAgentThought(payload: GovernedPayload): WorkflowVerdict;
}

@preset("codex")
interface CodexPreset {
  @maps_to("ActivityStarted", "UserPromptSubmit")
  userPromptSubmit(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "PreToolUse")
  preToolUse(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "PermissionRequest")
  permissionRequest(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "PostToolUse")
  postToolUse(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "Stop")
  stop(payload: GovernedPayload): WorkflowVerdict;
}

@preset("copilot")
interface CopilotPreset {
  @maps_to("ActivityStarted", "userPromptSubmitted")
  userPromptSubmitted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "preToolUse")
  preToolUse(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "postToolUse")
  postToolUse(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "agentStop")
  agentStop(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "subagentStop")
  subagentStop(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "errorOccurred")
  errorOccurred(payload: GovernedPayload): WorkflowVerdict;
}

@preset("cline")
interface ClinePreset {
  @maps_to("ActivityStarted", "PreToolUse")
  preToolUse(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "PostToolUse")
  postToolUse(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "UserPromptSubmit")
  userPromptSubmit(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "TaskStart")
  taskStart(payload: GovernedPayload): WorkflowVerdict;
}

// --- Frameworks -----------------------------------------------------------

@preset("langchain")
interface LangChainPreset {
  @maps_to("ActivityStarted", "on_llm_start")
  onLlmStart(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "on_llm_end")
  onLlmEnd(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "on_llm_error")
  onLlmError(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "on_chat_model_start")
  onChatModelStart(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "on_tool_start")
  onToolStart(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "on_tool_end")
  onToolEnd(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "on_tool_error")
  onToolError(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "on_chain_start")
  onChainStart(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "on_chain_end")
  onChainEnd(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "on_agent_action")
  onAgentAction(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "on_agent_finish")
  onAgentFinish(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "on_retriever_start")
  onRetrieverStart(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "on_retriever_end")
  onRetrieverEnd(payload: GovernedPayload): WorkflowVerdict;
}

@preset("langgraph")
interface LangGraphPreset {
  @maps_to("ActivityStarted", "node_start")
  nodeStart(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "node_end")
  nodeEnd(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("SignalReceived", "interrupt")
  interrupt(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("SignalReceived", "checkpoint")
  checkpoint(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "task_start")
  taskStart(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "task_end")
  taskEnd(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("SignalReceived", "custom_event")
  customEvent(payload: GovernedPayload): WorkflowVerdict;
}

@preset("llamaindex")
interface LlamaIndexPreset {
  @maps_to("ActivityStarted", "CHUNKING")
  chunking(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "LLM")
  llm(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "QUERY")
  query(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "RETRIEVE")
  retrieve(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "SYNTHESIZE")
  synthesize(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "EMBEDDING")
  embedding(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "FUNCTION_CALL")
  functionCall(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "AGENT_STEP")
  agentStep(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "RERANKING")
  reranking(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "SUB_QUESTION")
  subQuestion(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "EXCEPTION")
  exception(payload: GovernedPayload): WorkflowVerdict;
}

@preset("crewai")
interface CrewAiPreset {
  @maps_to("ActivityStarted", "CrewKickoffStarted")
  crewKickoffStarted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "CrewKickoffCompleted")
  crewKickoffCompleted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "AgentExecutionStarted")
  agentExecutionStarted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "AgentExecutionCompleted")
  agentExecutionCompleted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "TaskStarted")
  taskStarted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "TaskCompleted")
  taskCompleted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "ToolUsageStarted")
  toolUsageStarted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "ToolUsageFinished")
  toolUsageFinished(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "ToolUsageError")
  toolUsageError(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "LLMCallStarted")
  llmCallStarted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "LLMCallCompleted")
  llmCallCompleted(payload: GovernedPayload): WorkflowVerdict;
}

@preset("autogen")
interface AutogenPreset {
  @maps_to("ActivityCompleted", "TextMessage")
  textMessage(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "MultiModalMessage")
  multiModalMessage(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "ToolCallRequestEvent")
  toolCallRequestEvent(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "ToolCallExecutionEvent")
  toolCallExecutionEvent(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "MemoryQueryEvent")
  memoryQueryEvent(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("SignalReceived", "UserInputRequestedEvent")
  userInputRequestedEvent(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("SignalReceived", "HandoffMessage")
  handoffMessage(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "StopMessage")
  stopMessage(payload: GovernedPayload): WorkflowVerdict;
}

@preset("mastra")
interface MastraPreset {
  @maps_to("ActivityStarted", "workflow-step-start")
  workflowStepStart(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "workflow-step-finish")
  workflowStepFinish(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "workflow-step-progress")
  workflowStepProgress(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "tool-call")
  toolCall(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "tool-result")
  toolResult(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "error")
  error(payload: GovernedPayload): WorkflowVerdict;
}

@preset("vercel-ai")
interface VercelAiPreset {
  @maps_to("ActivityCompleted", "onStepFinish")
  onStepFinish(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "onFinish")
  onFinish(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "onError")
  onError(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "onAbort")
  onAbort(payload: GovernedPayload): WorkflowVerdict;
}

@preset("pydantic-ai")
interface PydanticAiPreset {
  @maps_to("ActivityStarted", "UserPromptNode")
  userPromptNode(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "ModelRequestNode")
  modelRequestNode(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "CallToolsNode")
  callToolsNode(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "End")
  end(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "output_validator")
  outputValidator(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "tool_retry")
  toolRetry(payload: GovernedPayload): WorkflowVerdict;
}

@preset("semantic-kernel")
interface SemanticKernelPreset {
  @maps_to("ActivityStarted", "function_invocation_pre")
  functionInvocationPre(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "function_invocation_post")
  functionInvocationPost(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "prompt_render_pre")
  promptRenderPre(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "prompt_render_post")
  promptRenderPost(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "auto_function_invocation_pre")
  autoFunctionInvocationPre(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "auto_function_invocation_post")
  autoFunctionInvocationPost(payload: GovernedPayload): WorkflowVerdict;
}

// --- Workflow / orchestration --------------------------------------------

@preset("temporal")
interface TemporalPreset {
  @maps_to("ActivityStarted", "ActivityTaskScheduled")
  activityTaskScheduled(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "ActivityTaskStarted")
  activityTaskStarted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "ActivityTaskCompleted")
  activityTaskCompleted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "ActivityTaskFailed")
  activityTaskFailed(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "ActivityTaskTimedOut")
  activityTaskTimedOut(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "ActivityTaskCanceled")
  activityTaskCanceled(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "ChildWorkflowExecutionInitiated")
  childWorkflowExecutionInitiated(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "ChildWorkflowExecutionCompleted")
  childWorkflowExecutionCompleted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("SignalReceived", "WorkflowExecutionSignaled")
  workflowExecutionSignaled(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("SignalReceived", "MarkerRecorded")
  markerRecorded(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("SignalReceived", "TimerStarted")
  timerStarted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("SignalReceived", "TimerFired")
  timerFired(payload: GovernedPayload): WorkflowVerdict;
}

@preset("airflow")
interface AirflowPreset {
  @maps_to("ActivityStarted", "on_execute_callback")
  onExecuteCallback(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "on_success_callback")
  onSuccessCallback(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "on_failure_callback")
  onFailureCallback(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "on_retry_callback")
  onRetryCallback(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "sla_miss_callback")
  slaMissCallback(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "on_skipped_callback")
  onSkippedCallback(payload: GovernedPayload): WorkflowVerdict;
}

@preset("n8n")
interface N8nPreset {
  @maps_to("ActivityStarted", "node-pre-execute")
  nodePreExecute(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "node-post-execute")
  nodePostExecute(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "error-trigger")
  errorTrigger(payload: GovernedPayload): WorkflowVerdict;
}

// --- Specialized domains --------------------------------------------------

@preset("pagerduty")
interface PagerDutyPreset {
  @maps_to("ActivityStarted", "incident.triggered")
  incidentTriggered(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "incident.acknowledged")
  incidentAcknowledged(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "incident.escalated")
  incidentEscalated(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "incident.reassigned")
  incidentReassigned(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "incident.delegated")
  incidentDelegated(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "incident.priority_updated")
  incidentPriorityUpdated(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "incident.resolved")
  incidentResolved(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "incident.reopened")
  incidentReopened(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "incident.unacknowledged")
  incidentUnacknowledged(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "incident.annotated")
  incidentAnnotated(payload: GovernedPayload): WorkflowVerdict;
}

@preset("argocd")
interface ArgoCdPreset {
  @maps_to("ActivityStarted", "OperationStarted")
  operationStarted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "OperationCompleted")
  operationCompleted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "ResourceUpdated")
  resourceUpdated(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "PreSyncHookStarted")
  preSyncHookStarted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "PreSyncHookSucceeded")
  preSyncHookSucceeded(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "SyncStatusChanged")
  syncStatusChanged(payload: GovernedPayload): WorkflowVerdict;
}

@preset("modern-treasury")
interface ModernTreasuryPreset {
  @maps_to("ActivityStarted", "payment_order.approved")
  paymentOrderApproved(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "payment_order.begin_processing")
  paymentOrderBeginProcessing(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "payment_order.failed")
  paymentOrderFailed(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "payment_order.reconciled")
  paymentOrderReconciled(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "payment_reference.created")
  paymentReferenceCreated(payload: GovernedPayload): WorkflowVerdict;
}

// ---------------------------------------------------------------------------
// Tier 3 - escape hatches
// ---------------------------------------------------------------------------

/**
 * Generic typed preset - for agents that don't fit a specific framework
 * but want first-class methods. The activity_type strings here are the
 * canonical first-party SDK convention (drawn from claude-hooks +
 * cursor-hooks + the openbox skill's canonical-union list).
 */
@preset("default")
interface DefaultPreset {
  @maps_to("ActivityStarted", "PromptSubmission")
  prompt(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "LLMCompleted")
  llm(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "ToolStarted")
  tool(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "ToolCompleted")
  toolCompleted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "FileRead")
  read(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "FileEdit")
  write(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "FileDelete")
  fileDelete(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "ShellExecution")
  shell(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "HTTPRequest")
  httpRequest(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "MCPToolCall")
  mcpToolCall(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "AgentSpawn")
  agentSpawn(payload: GovernedPayload): WorkflowVerdict;
}

/**
 * Free-form escape hatch for domain agents (FinOps, IAM, RPA,
 * procurement) whose activity_type vocabulary doesn't match any
 * framework. Still wraps in the canonical envelope, so guardrails,
 * trust scoring, and attestation all work normally.
 *
 * Note: this is the ONE preset whose method takes the activityType +
 * stage as parameters. All other presets bake those into the method
 * name via @maps_to.
 */
@preset("custom")
interface CustomPreset {
  /**
   * Run an arbitrary activity. The runtime stamps:
   *   stage="pre"  -> event_type=ActivityStarted
   *   stage="post" -> event_type=ActivityCompleted
   * The activityType string is whatever the team uses (e.g.
   * "WireTransferApproval", "IAMRoleGrant", "ProcurementPOApproval").
   */
  activity(
    activityType: string,
    stage: ActivityStage,
    payload: GovernedPayload,
  ): WorkflowVerdict;
}
