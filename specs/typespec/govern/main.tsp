// specs/typespec/govern/main.tsp; language-agnostic shape of the
// governance protocol that wraps every governed agent action.
//
// THREE-TIER MODEL:
//
// Tier 1 (locked); `CanonicalEventType`. Seven values the core service
//   accepts for lifecycle storage, guardrail/metric routing, and handoff
//   storage.
//   Lifecycle (Workflow{Started,Completed,Failed}) is SDK-internal:
//   the runtime fires it via try/finally + process-exit handlers, never
//   user code. So workflows can't hang in PENDING state.
//
// Tier 2 (presets); one @preset interface per framework. Each method
//   maps to the canonical envelope via @maps_to(eventType, activityType).
//   Generated runtime exposes one Session class per preset. User picks
//   the preset that matches their framework; SDK does the right wrapping.
//
// Tier 3 (escape); `default` (generic typed methods, framework-agnostic)
//   and `custom` (free-form `activity(name, stage, payload)` for domain
//   agents; FinOps, IAM, RPA, procurement; whose vocabularies don't
//   fit any framework).
//
// Note: programming-model spec, not an HTTP API. We deliberately do NOT
// mark this `@service`; the openapi3 emitter quietly skips non-service
// namespaces, which is what we want.

import "typespec-workflow";

using OpenBox.Workflow;

/**
 * Display-label table for every canonical activity_type. Single source of
 * truth for any consumer that renders activity types in a UI (mobile app,
 * web dashboard, CLI list views, audit reports). The emitter materializes
 * the table as `CANONICAL_ACTIVITY_LABELS` in the generated output, so
 * adding a new @maps_to or @activityRouting entry requires bumping this
 * table; caught by the drift test in tests/unit/govern-coverage.test.ts.
 *
 * Naming conventions:
 *   - Acronyms preserved as-is: LLM, MCP, HTTP, CLI, IAM, DLP, SDK, API
 *   - PascalCase split on word boundary: `LLMCompleted` → "LLM Completed"
 *   - snake_case → Title Case: `on_llm_end` → "LLM End"
 *   - kebab-case → Title Case: `node-pre-execute` → "Node Pre-Execute"
 *   - Dotted namespaces preserved: `incident.triggered` → "Incident Triggered"
 *   - SCREAMING_CASE → Title Case: `CHUNKING` → "Chunking"
 */
@activityLabels(#{
  // Tier 1; canonical envelope (event_type values, surfaced for parity).
  // Not strictly activity_types but consumers sometimes render them too.

  // --- Default preset ----------------------------------------------------
  PromptSubmission: "Prompt Submission",
  llm_call: "LLM Call",
  LLMCompleted: "LLM Completed",
  ToolStarted: "Tool Started",
  ToolCompleted: "Tool Completed",
  FileRead: "File Read",
  FileEdit: "File Edit",
  FileDelete: "File Delete",
  ShellExecution: "Shell Execution",
  DatabaseQuery: "Database Query",
  HTTPRequest: "HTTP Request",
  MCPToolCall: "MCP Tool Call",
  AgentSpawn: "Agent Spawn",
  AgentAction: "Agent Action",
  OpenAIAgentsSDKRun: "OpenAI Agents SDK Run",
  AgentHandoff: "Agent Handoff",
  GuardrailEvaluation: "Guardrail Evaluation",

  // --- Coding agents -----------------------------------------------------
  PreToolUse: "Pre-Tool Use",
  PostToolUse: "Post-Tool Use",
  UserPromptSubmit: "User Prompt Submit",
  PermissionRequest: "Permission Request",
  SessionStart: "Session Start",
  PreCompact: "Pre-Compact",
  SubagentStart: "Subagent Start",
  SubagentStop: "Subagent Stop",
  PostToolUseFailure: "Post-Tool Use Failure",
  PostToolBatch: "Post-Tool Batch",
  MessageDisplay: "Message Display",
  Notification: "Notification",
  Stop: "Stop",
  ClaudeCodeSession: "Claude Code Session",
  ClaudeCodeMessage: "Claude Code Message",
  ClaudeCodeConfigChange: "Claude Code Config Change",
  ClaudeCodeWorkspaceChange: "Claude Code Workspace Change",
  ClaudeCodeTask: "Claude Code Task",
  CodexSession: "Codex Session",
  AnthropicAgentSDKSession: "Anthropic Agent SDK Session",
  AnthropicAgentSDKMessage: "Anthropic Agent SDK Message",
  AnthropicAgentSDKConfigChange: "Anthropic Agent SDK Config Change",
  AnthropicAgentSDKWorkspaceChange: "Anthropic Agent SDK Workspace Change",
  AnthropicAgentSDKTask: "Anthropic Agent SDK Task",
  MCPElicitation: "MCP Elicitation",
  user_prompt: "User Prompt",
  claude_usage: "Claude Usage",
  anthropic_agent_sdk_usage: "Anthropic Agent SDK Usage",
  // Cursor; lowerCamel hook names
  beforeSubmitPrompt: "Before Submit Prompt",
  preToolUse: "Pre-Tool Use",
  postToolUse: "Post-Tool Use",
  beforeShellExecution: "Before Shell Execution",
  afterShellExecution: "After Shell Execution",
  beforeMCPExecution: "Before MCP Execution",
  afterMCPExecution: "After MCP Execution",
  beforeReadFile: "Before Read File",
  afterFileEdit: "After File Edit",
  afterAgentResponse: "After Agent Response",
  afterAgentThought: "After Agent Thought",
  // Copilot
  userPromptSubmitted: "User Prompt Submitted",
  agentStop: "Agent Stop",
  subagentStop: "Subagent Stop",
  errorOccurred: "Error Occurred",
  // Cline
  TaskStart: "Task Start",

  // --- Frameworks --------------------------------------------------------
  // LangChain (snake_case event names)
  on_llm_start: "LLM Start",
  on_llm_end: "LLM End",
  on_llm_error: "LLM Error",
  on_chat_model_start: "Chat Model Start",
  on_tool_start: "Tool Start",
  on_tool_end: "Tool End",
  on_tool_error: "Tool Error",
  on_chain_start: "Chain Start",
  on_chain_end: "Chain End",
  on_agent_action: "Agent Action",
  on_agent_finish: "Agent Finish",
  on_retriever_start: "Retriever Start",
  on_retriever_end: "Retriever End",
  // LangGraph
  node_start: "Node Start",
  node_end: "Node End",
  interrupt: "Interrupt",
  checkpoint: "Checkpoint",
  task_start: "Task Start",
  task_end: "Task End",
  custom_event: "Custom Event",
  // LlamaIndex (SCREAMING_CASE)
  CHUNKING: "Chunking",
  LLM: "LLM",
  QUERY: "Query",
  RETRIEVE: "Retrieve",
  SYNTHESIZE: "Synthesize",
  EMBEDDING: "Embedding",
  FUNCTION_CALL: "Function Call",
  AGENT_STEP: "Agent Step",
  RERANKING: "Reranking",
  SUB_QUESTION: "Sub-Question",
  EXCEPTION: "Exception",
  // CrewAI
  CrewKickoffStarted: "Crew Kickoff Started",
  CrewKickoffCompleted: "Crew Kickoff Completed",
  AgentExecutionStarted: "Agent Execution Started",
  AgentExecutionCompleted: "Agent Execution Completed",
  TaskStarted: "Task Started",
  TaskCompleted: "Task Completed",
  ToolUsageStarted: "Tool Usage Started",
  ToolUsageFinished: "Tool Usage Finished",
  ToolUsageError: "Tool Usage Error",
  LLMCallStarted: "LLM Call Started",
  LLMCallCompleted: "LLM Call Completed",
  // Autogen
  TextMessage: "Text Message",
  MultiModalMessage: "Multi-Modal Message",
  ToolCallRequestEvent: "Tool Call Request",
  ToolCallExecutionEvent: "Tool Call Execution",
  MemoryQueryEvent: "Memory Query",
  UserInputRequestedEvent: "User Input Requested",
  HandoffMessage: "Handoff Message",
  StopMessage: "Stop Message",
  // Mastra (kebab-case)
  `workflow-step-start`: "Workflow Step Start",
  `workflow-step-finish`: "Workflow Step Finish",
  `workflow-step-progress`: "Workflow Step Progress",
  `tool-call`: "Tool Call",
  `tool-result`: "Tool Result",
  error: "Error",
  // Vercel AI
  onStepFinish: "Step Finish",
  onFinish: "Finish",
  onError: "Error",
  onAbort: "Abort",
  // Pydantic AI
  UserPromptNode: "User Prompt Node",
  ModelRequestNode: "Model Request Node",
  CallToolsNode: "Call Tools Node",
  End: "End",
  output_validator: "Output Validator",
  tool_retry: "Tool Retry",
  // Semantic Kernel
  function_invocation_pre: "Function Invocation Pre",
  function_invocation_post: "Function Invocation Post",
  prompt_render_pre: "Prompt Render Pre",
  prompt_render_post: "Prompt Render Post",
  auto_function_invocation_pre: "Auto Function Invocation Pre",
  auto_function_invocation_post: "Auto Function Invocation Post",

  // --- Workflow / orchestration -----------------------------------------
  // Temporal
  ActivityTaskScheduled: "Activity Task Scheduled",
  ActivityTaskStarted: "Activity Task Started",
  ActivityTaskCompleted: "Activity Task Completed",
  ActivityTaskFailed: "Activity Task Failed",
  ActivityTaskTimedOut: "Activity Task Timed Out",
  ActivityTaskCanceled: "Activity Task Canceled",
  ChildWorkflowExecutionInitiated: "Child Workflow Execution Initiated",
  ChildWorkflowExecutionCompleted: "Child Workflow Execution Completed",
  WorkflowExecutionSignaled: "Workflow Execution Signaled",
  MarkerRecorded: "Marker Recorded",
  TimerStarted: "Timer Started",
  TimerFired: "Timer Fired",
  // Airflow
  on_execute_callback: "Execute Callback",
  on_success_callback: "Success Callback",
  on_failure_callback: "Failure Callback",
  on_retry_callback: "Retry Callback",
  sla_miss_callback: "SLA Miss Callback",
  on_skipped_callback: "Skipped Callback",
  // n8n
  `node-pre-execute`: "Node Pre-Execute",
  `node-post-execute`: "Node Post-Execute",
  `error-trigger`: "Error Trigger",

  // --- Specialized domains ----------------------------------------------
  // PagerDuty (dotted)
  `incident.triggered`: "Incident Triggered",
  `incident.acknowledged`: "Incident Acknowledged",
  `incident.escalated`: "Incident Escalated",
  `incident.reassigned`: "Incident Reassigned",
  `incident.delegated`: "Incident Delegated",
  `incident.priority_updated`: "Incident Priority Updated",
  `incident.resolved`: "Incident Resolved",
  `incident.reopened`: "Incident Reopened",
  `incident.unacknowledged`: "Incident Unacknowledged",
  `incident.annotated`: "Incident Annotated",
  // ArgoCD
  OperationStarted: "Operation Started",
  OperationCompleted: "Operation Completed",
  ResourceUpdated: "Resource Updated",
  PreSyncHookStarted: "Pre-Sync Hook Started",
  PreSyncHookSucceeded: "Pre-Sync Hook Succeeded",
  SyncStatusChanged: "Sync Status Changed",
  // Modern Treasury (dotted)
  `payment_order.approved`: "Payment Order Approved",
  `payment_order.begin_processing`: "Payment Order Begin Processing",
  `payment_order.failed`: "Payment Order Failed",
  `payment_order.reconciled`: "Payment Order Reconciled",
  `payment_reference.created`: "Payment Reference Created",

  // --- Adapter @activityRouting destinations ----------------------------
  // Cursor's preToolUse routes to lowercase activity_types that aren't
  // emitted from any @maps_to. Listed for label parity.
  file_read: "File Read",
  file_write: "File Write",
  agent_action: "Agent Action",
})
@governProtocol(#{
  name: "govern-protocol",
  description: "The govern() wrapper fires events in the right order with the right canonical activity_type strings, in every language.",
  cases: #[
    #{
      name: "single-allow",
      scenario: #[
        #{ kind: "begin_workflow", workflowId: "wf-1", runId: "run-1" },
        #{
          kind: "activity",
          activityType: "PromptSubmission",
          input: #[#{ prompt: "hello" }],
          verdict: #{ arm: "allow", riskScore: 0.1 },
        },
        #{ kind: "end_workflow" },
      ],
      expectedEvents: #[
        #{ event_type: "WorkflowStarted", workflow_id: "wf-1", run_id: "run-1" },
        #{ event_type: "ActivityStarted", activity_type: "PromptSubmission" },
        #{ event_type: "ActivityCompleted", activity_type: "PromptSubmission" },
        #{ event_type: "WorkflowCompleted", workflow_id: "wf-1", run_id: "run-1" },
      ],
    },
    #{
      name: "block-halts-workflow",
      scenario: #[
        #{ kind: "begin_workflow", workflowId: "wf-2", runId: "run-2" },
        #{
          kind: "activity",
          activityType: "ShellExecution",
          input: #[#{ command: "rm -rf /" }],
          verdict: #{ arm: "block", riskScore: 1.0, reason: "destructive" },
        },
      ],
      expectedEvents: #[
        #{ event_type: "WorkflowStarted", workflow_id: "wf-2", run_id: "run-2" },
        #{ event_type: "ActivityStarted", activity_type: "ShellExecution" },
        #{
          event_type: "WorkflowFailed",
          workflow_id: "wf-2",
          run_id: "run-2",
          status: "failed",
        },
      ],
      note: "Blocked activities never emit ActivityCompleted; the workflow ends in WorkflowFailed.",
    },
    #{
      name: "approval-poll-then-allow",
      scenario: #[
        #{ kind: "begin_workflow", workflowId: "wf-3", runId: "run-3" },
        #{
          kind: "activity",
          activityType: "ToolCompleted",
          input: #[#{ tool: "transfer_funds", amount: 5000 }],
          verdict: #{
            arm: "require_approval",
            approvalId: "ap-xyz",
            riskScore: 0.7,
          },
          approvalResolution: #{ arm: "allow", riskScore: 0.7 },
        },
        #{ kind: "end_workflow" },
      ],
      expectedEvents: #[
        #{ event_type: "WorkflowStarted", workflow_id: "wf-3", run_id: "run-3" },
        #{ event_type: "ActivityStarted", activity_type: "ToolCompleted" },
        #{ event_type: "ActivityCompleted", activity_type: "ToolCompleted" },
        #{ event_type: "WorkflowCompleted", workflow_id: "wf-3", run_id: "run-3" },
      ],
      note: "Approval polling happens between ActivityStarted and ActivityCompleted; SDK only emits one Started/Completed pair regardless of how many polls were issued.",
    },
  ],
})
@spanContract(#{
  // Truncation caps (chars/bytes) for the four hook span types.
  caps: #{ httpBody: 8192, fileData: 4096, dbStatement: 2000, functionArg: 2000 },
  truncationSuffix: "...[truncated]",
  redactedSentinel: "[REDACTED]",
  // OTel span status codes emitted on hook spans.
  statusCode: #{ unset: "UNSET", error: "ERROR" },
  // Canonical _SENSITIVE_HEADERS — exact keys, no substring heuristics.
  sensitiveHeaders: #[
    "authorization",
    "proxy-authorization",
    "cookie",
    "set-cookie",
    "www-authenticate",
    "x-api-key",
    "x-auth-token"
  ],
  // hook_type → OTel span kind.
  spanKind: #{
    file_operation: "INTERNAL",
    http_request: "CLIENT",
    db_query: "CLIENT",
    function_call: "INTERNAL",
  },
  // Span semantic_type computation (serverComputedSemanticType). `static` maps a
  // SpanType to a fixed semantic_type; http/db are contextual on method/operation.
  semanticType: #{
    static: #{
      llm: "llm_completion",
      llm_embedding: "llm_embedding",
      llm_tool_call: "llm_tool_call",
      file_read: "file_read",
      file_open: "file_open",
      file_write: "file_write",
      file_delete: "file_delete",
      shell: "internal",
      mcp: "mcp_tool_call",
    },
    httpByMethod: #{
      get: "http_get",
      post: "http_post",
      put: "http_put",
      patch: "http_patch",
      delete: "http_delete",
    },
    httpDefault: "http",
    dbByOperation: #{
      select: "database_select",
      insert: "database_insert",
      update: "database_update",
      delete: "database_delete",
    },
    dbDefault: "database_query",
  },
})
namespace OpenboxGovern;

// ---------------------------------------------------------------------------
// Tier 1; locked envelope
// ---------------------------------------------------------------------------

/**
 * Canonical event_type values the core service accepts. Unknown strings
 * are rejected by the Core API before workflow execution.
 */
enum CanonicalEventType {
  WorkflowStarted: "WorkflowStarted",
  WorkflowCompleted: "WorkflowCompleted",
  WorkflowFailed: "WorkflowFailed",
  ActivityStarted: "ActivityStarted",
  ActivityCompleted: "ActivityCompleted",
  SignalReceived: "SignalReceived",
  Handoff: "Handoff",
}

/** Stage prefix on guardrail field paths. "0" = start, "1" = complete. */
enum ActivityStage {
  pre: "pre",
  post: "post",
}

/** Five arms emitted by the live core. `constrain` means the action is
 *  allowed only with the transformed/redacted payload returned by Core. */
enum VerdictArm {
  allow: "allow",
  constrain: "constrain",
  require_approval: "require_approval",
  block: "block",
  halt: "halt",
}

/**
 * Public-facing workflow verdict; what every preset method returns
 * to the caller. The runtime maps the wire `GovernanceVerdictResponse`
 * to this shape, promoting the arm into a structured payload alongside
 * risk/trust data and the approval-polling handle.
 */
/**
 * Per-field guardrail outcome. Mirrors core's GuardrailFieldResult.
 */
model GuardrailFieldVerdict {
  field: string;
  /** Guardrail group/type that produced this field outcome, when Core returns grouped results. */
  guardrailType?: string;
  /** Field evaluation order from Core's GuardrailFieldResult. */
  order?: int32;
  status: "allowed" | "blocked" | "redacted" | "transformed" | "skipped";
  reason?: string;
}

/**
 * Reason carrier on guardrail outcomes; same shape as core's
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
  inputType: "activity_input" | "activity_output" | "signal_args";

  /**
   * Redacted payload as decided by the guardrail service. Pass to
   * `applyInputRedaction(...)` / `applyOutputRedaction(...)` against the
   * original payload to forward a safe version downstream. `signal_args`
   * is input-like and uses `applyInputRedaction(...)`.
   */
  redactedInput?: unknown;

  /**
   * Output-specific redacted payload for SDK/provider compatibility.
   * Core's public GuardrailsResult uses `redacted_input` as the
   * canonical validated payload, including `activity_output`; adapters
   * may still prefer this value when a provider bridge supplies it and
   * fall back to `redactedInput` for Core responses.
   */
  redactedOutput?: unknown;

  /** False when any field result is `blocked`. */
  validationPassed: boolean;

  /** Raw guardrail-service output, retained for debugging and parity with Core. */
  rawLogs?: Record<unknown>;

  reasons: GuardrailReasonRef[];

  fieldResults: GuardrailFieldVerdict[];
}

@verdict
model WorkflowVerdict {
  arm: VerdictArm;

  /** Set on `require_approval`; opaque ID for the polling endpoint. */
  approvalId?: string;

  /**
   * Backend's `governance_event_id` echoed verbatim. Cross-reference
   * key used by hook adapters to find the persisted Approval row in
   * the dashboard's pending list when the evaluate response omits
   * `approvalId` (current backend behavior). Backend approval
   * decisions use the Approval row primary `id`.
   */
  governanceEventId?: string;

  /** Wall-clock cutoff for `require_approval`; SDK stops polling after this. */
  approvalExpiresAt?: utcDateTime;

  /** Human-readable explanation when the arm isn't `allow`. */
  reason?: string;

  /** Aggregate risk score in [0, 1]. */
  riskScore: float64;

  /** Agent trust tier (1-4) at the moment of evaluation. */
  trustTier?: int32;

  /** Top-level goal-alignment score returned by older Core/AGE response paths. */
  alignmentScore?: float64;

  /** OPA/behavior policy id that produced this verdict, when Core returns one. */
  policyId?: string;

  /** Behavior-rule names that triggered during evaluation. */
  behavioralViolations?: string[];

  /** Set on `constrain`; enforcement hints for transformed output. */
  constraints?: string[];

  /** Free-form Core metadata attached to the verdict. */
  metadata?: Record<unknown>;

  /** True when one or more required governance checks did not complete. */
  governanceChecksIncomplete?: boolean;

  /**
   * Guardrails outcome; populated when a guardrail fired (PII/safety/
   * content checks). `redactedInput` is the safe payload to forward
   * downstream; `reasons` and `fieldResults` describe what happened
   * per field. Adapters use this to apply redaction post-verdict
   * without parsing the raw wire response.
   */
  guardrailsResult?: GuardrailsVerdict;

  /**
   * Core AGE/governance evaluator output. This mirrors the core wire
   * response's `age_result` field and is intentionally free-form here
   * because the govern programming model does not import the Core HTTP
   * namespace.
   */
  ageResult?: unknown;

  /**
   * The activity id this verdict was evaluated under. Callers that need
   * cross-request correlation (for example HITL approval resume, which
   * polls on workflow_id + run_id + activity_id) read it from here.
   */
  activityId?: string;
}

/**
 * Cross-SDK source attribution contract for approval rows. The Core
 * Approval model does not have a dedicated source column yet, so SDKs
 * stamp the first activity input item with `inputKey`; pending-approval
 * readers use that value after the backend has stripped span details.
 */
model SourceAttributionContract {
  /** Activity input key used by SDKs for source attribution. */
  inputKey: "_openbox_source";

  /** Default source used by the generic Python governed-session runtime. */
  defaultPythonSource: "python-sdk";

  /** Canonical Core event source for generated governed-session payloads. */
  workflowEventSource: "workflow-telemetry";
}

/** Free-form input/output payload. Server stringifies; SDKs pass through. */
model GovernedPayload {
  /** Activity input (request side). Wrap singletons as a one-element array. */
  input?: unknown[];

  /** Activity output (response side); only set on completion events. */
  output?: unknown;

  /** Caller/runtime session identifier, distinct from Core's internal session UUID. */
  sessionId?: string;

  /** LLM model identifier for normal ActivityStarted/ActivityCompleted telemetry. */
  llmModel?: string;

  /** Prompt/input token count observed by the SDK. */
  inputTokens?: numeric;

  /** Completion/output token count observed by the SDK. */
  outputTokens?: numeric;

  /** Total token count observed by the SDK. */
  totalTokens?: numeric;

  /** Estimated provider/API cost in USD observed by the SDK. */
  costUsd?: numeric;

  /** True when the LLM completion requested tool calls. */
  hasToolCalls?: boolean;

  /** Provider finish reason, when available. */
  finishReason?: string;

  /** Prompt text for LLM start events, when available. */
  prompt?: string;

  /** Assistant completion text for LLM completion events, when available. */
  completion?: string;

  /** Tool/function name for tool-call activities. */
  toolName?: string;

  /** Tool/function category such as http, database, builtin, a2a, or custom. */
  toolType?: string;

  /** Parent runtime run id when emitted by frameworks that expose nested runs. */
  parentRunId?: string;

  /** Cross-agent grouping id. Core stores this on the session and on handoff rows. */
  multiAgentSessionId?: string;

  /**
   * Set on `Handoff` only. The receiving agent is the authenticated
   * emitter; this field identifies the source agent DID.
   */
  fromAgentDid?: string;

  /**
   * Caller-supplied activity id. When absent the SDK mints one. Supply it
   * when the same logical activity must be referenced across requests,
   * for example HITL approval resume.
   */
  activityId?: string;

  /** Activity start time in epoch milliseconds. */
  startTime?: numeric;

  /** Activity end time in epoch milliseconds. */
  endTime?: numeric;

  /** Activity duration in milliseconds. Defaults to `endTime - startTime`. */
  durationMs?: numeric;

  /** Signal name for `SignalReceived` events (for example `user_prompt`). */
  signalName?: string;

  /**
   * Signal arguments for `SignalReceived` events. Backends surface the
   * `user_prompt` signal's args as the session intent.
   */
  signalArgs?: unknown;

  /**
   * Spans describing the underlying operation. REQUIRED for behavior-rule
   * matching: SDKs emit typed root fields and classifier gate attributes
   * (`http.method`, `http.url`, `file.path`, `db.system`, `gen_ai.system`,
   * `shell.command`); Core computes each span's `semantic_type` and
   * resolves the trigger the rule was created against. Without spans,
   * behavior rules silently never fire; the verdict falls through to default-allow with
   * `policy_id="00000000-0000-0000-0000-000000000000"`. See
   * `skill/references/span-reference.md` for span shapes by semantic type.
   */
  spans?: unknown[];

  /**
   * SDK-internal span persistence hint. When a completion/observe event carries
   * spans, the runtime re-evaluates those spans against the existing
   * ActivityStarted parent row instead of attaching them to the completion row.
   */
  hookSpanParentEventType?: "ActivityStarted";

  /**
   * SDK-internal span persistence hint for observe-only outputs that do not
   * have a natural pre/start hook. When true, the runtime emits a minimal
   * ActivityStarted parent before sending hook spans.
   */
  ensureHookSpanParent?: boolean;
}

// ---------------------------------------------------------------------------
// Tier 2; framework presets
//
// One @preset interface per framework. The emitter generates a
// `<PascalName>Session` class for each, with one method per operation
// that internally calls `runActivity(eventType, activityType, payload)`.
// Lifecycle (Workflow{Started,Completed,Failed}) is fired by the SDK
// runtime; presets never declare it.
//
// Streaming events (per-token chunks like LangChain `on_llm_new_token`,
// Vercel `onChunk` text-delta) are intentionally omitted; gating per
// token is rarely useful (can't redact mid-stream) and burns rate limit.
// The pattern is to aggregate the stream and emit one ActivityCompleted
// at end-of-stream. Custom callers can still emit per-token via the
// `custom` preset's free-form `activity()` if they need to.
// ---------------------------------------------------------------------------

// --- Coding agents --------------------------------------------------------

@preset("claude-code")
interface ClaudeCodePreset {
  @maps_to("ActivityStarted", "ClaudeCodeSession")
  sessionActivityStarted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "ClaudeCodeSession")
  sessionActivityCompleted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "ClaudeCodeMessage")
  messageActivityStarted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "ClaudeCodeMessage")
  messageActivityCompleted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("SignalReceived", "ClaudeCodeMessage")
  messageSignalReceived(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "ClaudeCodeConfigChange")
  configChangeActivity(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("SignalReceived", "ClaudeCodeWorkspaceChange")
  workspaceChangeSignal(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "ClaudeCodeWorkspaceChange")
  workspaceChangeCompleted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "MCPElicitation")
  mcpElicitationStarted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "MCPElicitation")
  mcpElicitationCompleted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "ClaudeCodeTask")
  taskActivityStarted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "ClaudeCodeTask")
  taskActivityCompleted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("SignalReceived", "claude_usage")
  claudeUsageSignal(payload: GovernedPayload): WorkflowVerdict;

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

@preset("anthropic-agent-sdk")
interface AnthropicAgentSDKPreset {
  @maps_to("ActivityStarted", "AnthropicAgentSDKSession")
  sessionActivityStarted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "AnthropicAgentSDKSession")
  sessionActivityCompleted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "AnthropicAgentSDKMessage")
  messageActivityStarted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "AnthropicAgentSDKMessage")
  messageActivityCompleted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("SignalReceived", "AnthropicAgentSDKMessage")
  messageSignalReceived(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "AnthropicAgentSDKConfigChange")
  configChangeActivity(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("SignalReceived", "AnthropicAgentSDKWorkspaceChange")
  workspaceChangeSignal(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "AnthropicAgentSDKWorkspaceChange")
  workspaceChangeCompleted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "MCPElicitation")
  mcpElicitationStarted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "MCPElicitation")
  mcpElicitationCompleted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "AnthropicAgentSDKTask")
  taskActivityStarted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "AnthropicAgentSDKTask")
  taskActivityCompleted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("SignalReceived", "anthropic_agent_sdk_usage")
  usageSignal(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "SessionStart")
  sessionStart(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "UserPromptSubmit")
  userPromptSubmit(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "PreToolUse")
  preToolUse(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "PermissionRequest")
  permissionRequest(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "PostToolUse")
  postToolUse(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "PostToolUseFailure")
  postToolUseFailure(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "PostToolBatch")
  postToolBatch(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "Stop")
  stop(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "SubagentStart")
  subagentStart(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "SubagentStop")
  subagentStop(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "PreCompact")
  preCompact(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "MessageDisplay")
  messageDisplay(payload: GovernedPayload): WorkflowVerdict;
}

@preset("cursor")
interface CursorPreset {
  @maps_to("ActivityStarted", "PromptSubmission")
  beforeSubmitPrompt(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "preToolUse")
  preToolUse(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "postToolUse")
  postToolUse(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "ShellExecution")
  beforeShellExecution(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "ShellExecution")
  afterShellExecution(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "MCPToolCall")
  beforeMCPExecution(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "MCPToolCall")
  afterMCPExecution(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "FileRead")
  beforeReadFile(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "FileEdit")
  afterFileEdit(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "LLMCompleted")
  afterAgentResponse(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "LLMCompleted")
  afterAgentThought(payload: GovernedPayload): WorkflowVerdict;
}

@preset("codex")
interface CodexPreset {
  @maps_to("ActivityCompleted", "CodexSession")
  sessionCompleted(payload: GovernedPayload): WorkflowVerdict;

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

@preset("openai-agents-sdk")
interface OpenAIAgentsSDKPreset {
  @maps_to("ActivityStarted", "OpenAIAgentsSDKRun")
  runStarted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "OpenAIAgentsSDKRun")
  runCompleted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "ToolStarted")
  toolStarted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "ToolCompleted")
  toolCompleted(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("Handoff", "AgentHandoff")
  handoff(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "GuardrailEvaluation")
  guardrail(payload: GovernedPayload): WorkflowVerdict;
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

  @maps_to("Handoff", "HandoffMessage")
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
// Tier 3; escape hatches
// ---------------------------------------------------------------------------

/**
 * Generic typed preset; for agents that don't fit a specific framework
 * but want first-class methods. The activity_type strings here are the
 * canonical first-party SDK convention (drawn from Claude Code hooks,
 * Cursor hooks, and the openbox skill's canonical-union list).
 */
@preset("default")
interface DefaultPreset {
  @maps_to("SignalReceived", "user_prompt")
  goalSignal(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "SessionStart")
  sessionStart(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityCompleted", "Stop")
  stop(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "UserPromptSubmit")
  userPromptSubmit(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "PromptSubmission")
  prompt(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "llm_call")
  llmCall(payload: GovernedPayload): WorkflowVerdict;

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

  @maps_to("ActivityStarted", "DatabaseQuery")
  databaseQuery(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "HTTPRequest")
  httpRequest(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "MCPToolCall")
  mcpToolCall(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "AgentSpawn")
  agentSpawn(payload: GovernedPayload): WorkflowVerdict;

  @maps_to("ActivityStarted", "AgentAction")
  agentAction(payload: GovernedPayload): WorkflowVerdict;
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
   * The activityType string is whatever the team uses, such as
   * "WireTransferApproval", "IAMRoleGrant", or "ProcurementPOApproval".
   */
  activity(
    activityType: string,
    stage: ActivityStage,
    payload: GovernedPayload,
  ): WorkflowVerdict;
}
