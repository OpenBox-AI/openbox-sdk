import { G as GovernanceEventPayload, h as GovernanceVerdictResponse, A as ApprovalStatusRequest, a as ApprovalStatusResponse } from './core-types-Dxgkbox0.js';

interface BehavioralResult {
    current_state?: string | null;
    next_state?: string | null;
    on_reject?: number;
    on_timeout?: number;
    pattern_name?: string | null;
    reason?: string;
    rule_id?: string | null;
    timeout_minutes?: number;
    verdict?: number;
    would_violate?: boolean;
}
interface CoreClientConfig {
    /** Base URL of the Core API. Defaults to OPENBOX_CORE_URL. */
    apiUrl?: string;
    /** Agent API key (obx_live_* or obx_test_*) */
    apiKey: string;
    /**
     * Optional one-time agent identity returned by Backend `createAgent`
     * / identity rotation. Core requires these signed DID headers when
     * the agent has `signing_required=true`.
     */
    agentIdentity?: AgentIdentityConfig;
    /** Request timeout in milliseconds. Default: 35000.
     *  Sits slightly above core's 30s WorkflowExecutionTimeout so when a
     *  workflow hits the server-side deadline, the client waits long
     *  enough to receive the 500 + actual error message instead of
     *  AbortController-cancelling first and surfacing an opaque
     *  "operation aborted". 5s margin covers handler+marshal overhead. */
    timeoutMs?: number;
    /** Retry configuration */
    retry?: {
        maxRetries?: number;
        initialDelayMs?: number;
        maxDelayMs?: number;
    };
    /** Client-side rate limiting */
    rateLimit?: {
        requestsPerSecond: number;
        burst?: number;
    };
}
interface AgentIdentityConfig {
    did: string;
    /** Raw Ed25519 private key bytes, base64 encoded. */
    privateKey: string;
}
declare class CoreApiError extends Error {
    readonly status: number;
    readonly body: unknown;
    constructor(message: string, status: number, body: unknown);
}
declare class OpenBoxCoreClient {
    private baseUrl;
    private config;
    private rateLimiter;
    constructor(config: CoreClientConfig);
    /**
     * Dynamic operation request used by compact API-first tooling.
     * Generated methods remain the preferred typed surface; this method
     * exists for operationId-driven callers that already resolved a
     * generated endpoint manifest entry.
     */
    requestOperation(method: string, path: string, options?: {
        params?: Record<string, unknown>;
        data?: unknown;
    }): Promise<unknown>;
    health(): Promise<string>;
    validateApiKey(): Promise<unknown>;
    evaluate(payload: GovernanceEventPayload): Promise<GovernanceVerdictResponse>;
    pollApproval(request: ApprovalStatusRequest): Promise<ApprovalStatusResponse>;
    private static readonly RETRYABLE_STATUSES;
    private request;
    /** Single-attempt fetch with the same per-request abort/timeout shape
     *  as one iteration of executeWithRetry. Used by endpoints that opt
     *  out of retries (evaluate). Network errors / timeouts surface as
     *  exceptions for reportAndExit; HTTP 5xx come back as Response so
     *  the caller can wrap them as CoreApiError. */
    private executeOnce;
    private executeWithRetry;
    private calculateBackoff;
}
declare function signAgentIdentityRequest(input: {
    identity: AgentIdentityConfig;
    method: string;
    path: string;
    body?: string;
    timestamp?: string;
    nonce?: string;
}): Record<string, string>;

type CanonicalEventType = "WorkflowStarted" | "WorkflowCompleted" | "WorkflowFailed" | "ActivityStarted" | "ActivityCompleted" | "SignalReceived";
type ActivityStage = "pre" | "post";
type VerdictArm = "allow" | "constrain" | "require_approval" | "block" | "halt";
interface GuardrailFieldVerdict {
    field: string;
    status: "allowed" | "blocked" | "redacted" | "skipped";
    reason?: string;
}
interface GuardrailReasonRef {
    type: string;
    field?: string;
    reason: string;
}
interface GuardrailsVerdict {
    inputType: "activity_input" | "activity_output";
    redactedInput?: unknown;
    validationPassed: boolean;
    reasons: GuardrailReasonRef[];
    fieldResults: GuardrailFieldVerdict[];
}
interface WorkflowVerdict {
    arm: VerdictArm;
    approvalId?: string;
    governanceEventId?: string;
    approvalExpiresAt?: string;
    reason?: string;
    riskScore: number;
    trustTier?: number;
    guardrailsResult?: GuardrailsVerdict;
    activityId?: string;
    ageResult?: GovernanceVerdictResponse['age_result'];
}
interface GovernedPayload {
    input?: unknown[];
    output?: unknown;
    activityId?: string;
    startTime?: number;
    endTime?: number;
    durationMs?: number;
    signalName?: string;
    signalArgs?: unknown;
    spans?: unknown[];
}
type CanonicalVerdict = WorkflowVerdict;
/** Spec-driven manifest of every preset + its method envelopes. */
declare const PRESET_MANIFEST: readonly [{
    readonly preset: "airflow";
    readonly methods: readonly [{
        readonly name: "onExecuteCallback";
        readonly eventType: "ActivityStarted";
        readonly activityType: "on_execute_callback";
    }, {
        readonly name: "onSuccessCallback";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "on_success_callback";
    }, {
        readonly name: "onFailureCallback";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "on_failure_callback";
    }, {
        readonly name: "onRetryCallback";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "on_retry_callback";
    }, {
        readonly name: "slaMissCallback";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "sla_miss_callback";
    }, {
        readonly name: "onSkippedCallback";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "on_skipped_callback";
    }];
}, {
    readonly preset: "argocd";
    readonly methods: readonly [{
        readonly name: "operationStarted";
        readonly eventType: "ActivityStarted";
        readonly activityType: "OperationStarted";
    }, {
        readonly name: "operationCompleted";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "OperationCompleted";
    }, {
        readonly name: "resourceUpdated";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "ResourceUpdated";
    }, {
        readonly name: "preSyncHookStarted";
        readonly eventType: "ActivityStarted";
        readonly activityType: "PreSyncHookStarted";
    }, {
        readonly name: "preSyncHookSucceeded";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "PreSyncHookSucceeded";
    }, {
        readonly name: "syncStatusChanged";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "SyncStatusChanged";
    }];
}, {
    readonly preset: "autogen";
    readonly methods: readonly [{
        readonly name: "textMessage";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "TextMessage";
    }, {
        readonly name: "multiModalMessage";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "MultiModalMessage";
    }, {
        readonly name: "toolCallRequestEvent";
        readonly eventType: "ActivityStarted";
        readonly activityType: "ToolCallRequestEvent";
    }, {
        readonly name: "toolCallExecutionEvent";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "ToolCallExecutionEvent";
    }, {
        readonly name: "memoryQueryEvent";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "MemoryQueryEvent";
    }, {
        readonly name: "userInputRequestedEvent";
        readonly eventType: "SignalReceived";
        readonly activityType: "UserInputRequestedEvent";
    }, {
        readonly name: "handoffMessage";
        readonly eventType: "SignalReceived";
        readonly activityType: "HandoffMessage";
    }, {
        readonly name: "stopMessage";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "StopMessage";
    }];
}, {
    readonly preset: "claude-code";
    readonly methods: readonly [{
        readonly name: "preToolUse";
        readonly eventType: "ActivityStarted";
        readonly activityType: "PreToolUse";
    }, {
        readonly name: "postToolUse";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "PostToolUse";
    }, {
        readonly name: "userPromptSubmit";
        readonly eventType: "ActivityStarted";
        readonly activityType: "UserPromptSubmit";
    }, {
        readonly name: "permissionRequest";
        readonly eventType: "ActivityStarted";
        readonly activityType: "PermissionRequest";
    }, {
        readonly name: "preCompact";
        readonly eventType: "ActivityStarted";
        readonly activityType: "PreCompact";
    }, {
        readonly name: "subagentStop";
        readonly eventType: "ActivityStarted";
        readonly activityType: "SubagentStop";
    }, {
        readonly name: "notification";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "Notification";
    }, {
        readonly name: "stop";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "Stop";
    }];
}, {
    readonly preset: "cline";
    readonly methods: readonly [{
        readonly name: "preToolUse";
        readonly eventType: "ActivityStarted";
        readonly activityType: "PreToolUse";
    }, {
        readonly name: "postToolUse";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "PostToolUse";
    }, {
        readonly name: "userPromptSubmit";
        readonly eventType: "ActivityStarted";
        readonly activityType: "UserPromptSubmit";
    }, {
        readonly name: "taskStart";
        readonly eventType: "ActivityStarted";
        readonly activityType: "TaskStart";
    }];
}, {
    readonly preset: "codex";
    readonly methods: readonly [{
        readonly name: "userPromptSubmit";
        readonly eventType: "ActivityStarted";
        readonly activityType: "UserPromptSubmit";
    }, {
        readonly name: "preToolUse";
        readonly eventType: "ActivityStarted";
        readonly activityType: "PreToolUse";
    }, {
        readonly name: "permissionRequest";
        readonly eventType: "ActivityStarted";
        readonly activityType: "PermissionRequest";
    }, {
        readonly name: "postToolUse";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "PostToolUse";
    }, {
        readonly name: "stop";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "Stop";
    }];
}, {
    readonly preset: "copilot";
    readonly methods: readonly [{
        readonly name: "userPromptSubmitted";
        readonly eventType: "ActivityStarted";
        readonly activityType: "userPromptSubmitted";
    }, {
        readonly name: "preToolUse";
        readonly eventType: "ActivityStarted";
        readonly activityType: "preToolUse";
    }, {
        readonly name: "postToolUse";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "postToolUse";
    }, {
        readonly name: "agentStop";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "agentStop";
    }, {
        readonly name: "subagentStop";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "subagentStop";
    }, {
        readonly name: "errorOccurred";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "errorOccurred";
    }];
}, {
    readonly preset: "crewai";
    readonly methods: readonly [{
        readonly name: "crewKickoffStarted";
        readonly eventType: "ActivityStarted";
        readonly activityType: "CrewKickoffStarted";
    }, {
        readonly name: "crewKickoffCompleted";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "CrewKickoffCompleted";
    }, {
        readonly name: "agentExecutionStarted";
        readonly eventType: "ActivityStarted";
        readonly activityType: "AgentExecutionStarted";
    }, {
        readonly name: "agentExecutionCompleted";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "AgentExecutionCompleted";
    }, {
        readonly name: "taskStarted";
        readonly eventType: "ActivityStarted";
        readonly activityType: "TaskStarted";
    }, {
        readonly name: "taskCompleted";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "TaskCompleted";
    }, {
        readonly name: "toolUsageStarted";
        readonly eventType: "ActivityStarted";
        readonly activityType: "ToolUsageStarted";
    }, {
        readonly name: "toolUsageFinished";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "ToolUsageFinished";
    }, {
        readonly name: "toolUsageError";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "ToolUsageError";
    }, {
        readonly name: "llmCallStarted";
        readonly eventType: "ActivityStarted";
        readonly activityType: "LLMCallStarted";
    }, {
        readonly name: "llmCallCompleted";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "LLMCallCompleted";
    }];
}, {
    readonly preset: "cursor";
    readonly methods: readonly [{
        readonly name: "beforeSubmitPrompt";
        readonly eventType: "ActivityStarted";
        readonly activityType: "beforeSubmitPrompt";
    }, {
        readonly name: "preToolUse";
        readonly eventType: "ActivityStarted";
        readonly activityType: "preToolUse";
    }, {
        readonly name: "postToolUse";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "postToolUse";
    }, {
        readonly name: "beforeShellExecution";
        readonly eventType: "ActivityStarted";
        readonly activityType: "beforeShellExecution";
    }, {
        readonly name: "afterShellExecution";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "afterShellExecution";
    }, {
        readonly name: "beforeMCPExecution";
        readonly eventType: "ActivityStarted";
        readonly activityType: "beforeMCPExecution";
    }, {
        readonly name: "afterMCPExecution";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "afterMCPExecution";
    }, {
        readonly name: "beforeReadFile";
        readonly eventType: "ActivityStarted";
        readonly activityType: "beforeReadFile";
    }, {
        readonly name: "afterFileEdit";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "afterFileEdit";
    }, {
        readonly name: "afterAgentResponse";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "afterAgentResponse";
    }, {
        readonly name: "afterAgentThought";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "afterAgentThought";
    }];
}, {
    readonly preset: "custom";
    readonly methods: readonly [{
        readonly name: "activity";
    }];
}, {
    readonly preset: "default";
    readonly methods: readonly [{
        readonly name: "prompt";
        readonly eventType: "ActivityStarted";
        readonly activityType: "PromptSubmission";
    }, {
        readonly name: "llm";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "LLMCompleted";
    }, {
        readonly name: "tool";
        readonly eventType: "ActivityStarted";
        readonly activityType: "ToolStarted";
    }, {
        readonly name: "toolCompleted";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "ToolCompleted";
    }, {
        readonly name: "read";
        readonly eventType: "ActivityStarted";
        readonly activityType: "FileRead";
    }, {
        readonly name: "write";
        readonly eventType: "ActivityStarted";
        readonly activityType: "FileEdit";
    }, {
        readonly name: "fileDelete";
        readonly eventType: "ActivityStarted";
        readonly activityType: "FileDelete";
    }, {
        readonly name: "shell";
        readonly eventType: "ActivityStarted";
        readonly activityType: "ShellExecution";
    }, {
        readonly name: "httpRequest";
        readonly eventType: "ActivityStarted";
        readonly activityType: "HTTPRequest";
    }, {
        readonly name: "mcpToolCall";
        readonly eventType: "ActivityStarted";
        readonly activityType: "MCPToolCall";
    }, {
        readonly name: "agentSpawn";
        readonly eventType: "ActivityStarted";
        readonly activityType: "AgentSpawn";
    }];
}, {
    readonly preset: "langchain";
    readonly methods: readonly [{
        readonly name: "onLlmStart";
        readonly eventType: "ActivityStarted";
        readonly activityType: "on_llm_start";
    }, {
        readonly name: "onLlmEnd";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "on_llm_end";
    }, {
        readonly name: "onLlmError";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "on_llm_error";
    }, {
        readonly name: "onChatModelStart";
        readonly eventType: "ActivityStarted";
        readonly activityType: "on_chat_model_start";
    }, {
        readonly name: "onToolStart";
        readonly eventType: "ActivityStarted";
        readonly activityType: "on_tool_start";
    }, {
        readonly name: "onToolEnd";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "on_tool_end";
    }, {
        readonly name: "onToolError";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "on_tool_error";
    }, {
        readonly name: "onChainStart";
        readonly eventType: "ActivityStarted";
        readonly activityType: "on_chain_start";
    }, {
        readonly name: "onChainEnd";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "on_chain_end";
    }, {
        readonly name: "onAgentAction";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "on_agent_action";
    }, {
        readonly name: "onAgentFinish";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "on_agent_finish";
    }, {
        readonly name: "onRetrieverStart";
        readonly eventType: "ActivityStarted";
        readonly activityType: "on_retriever_start";
    }, {
        readonly name: "onRetrieverEnd";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "on_retriever_end";
    }];
}, {
    readonly preset: "langgraph";
    readonly methods: readonly [{
        readonly name: "nodeStart";
        readonly eventType: "ActivityStarted";
        readonly activityType: "node_start";
    }, {
        readonly name: "nodeEnd";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "node_end";
    }, {
        readonly name: "interrupt";
        readonly eventType: "SignalReceived";
        readonly activityType: "interrupt";
    }, {
        readonly name: "checkpoint";
        readonly eventType: "SignalReceived";
        readonly activityType: "checkpoint";
    }, {
        readonly name: "taskStart";
        readonly eventType: "ActivityStarted";
        readonly activityType: "task_start";
    }, {
        readonly name: "taskEnd";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "task_end";
    }, {
        readonly name: "customEvent";
        readonly eventType: "SignalReceived";
        readonly activityType: "custom_event";
    }];
}, {
    readonly preset: "llamaindex";
    readonly methods: readonly [{
        readonly name: "chunking";
        readonly eventType: "ActivityStarted";
        readonly activityType: "CHUNKING";
    }, {
        readonly name: "llm";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "LLM";
    }, {
        readonly name: "query";
        readonly eventType: "ActivityStarted";
        readonly activityType: "QUERY";
    }, {
        readonly name: "retrieve";
        readonly eventType: "ActivityStarted";
        readonly activityType: "RETRIEVE";
    }, {
        readonly name: "synthesize";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "SYNTHESIZE";
    }, {
        readonly name: "embedding";
        readonly eventType: "ActivityStarted";
        readonly activityType: "EMBEDDING";
    }, {
        readonly name: "functionCall";
        readonly eventType: "ActivityStarted";
        readonly activityType: "FUNCTION_CALL";
    }, {
        readonly name: "agentStep";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "AGENT_STEP";
    }, {
        readonly name: "reranking";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "RERANKING";
    }, {
        readonly name: "subQuestion";
        readonly eventType: "ActivityStarted";
        readonly activityType: "SUB_QUESTION";
    }, {
        readonly name: "exception";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "EXCEPTION";
    }];
}, {
    readonly preset: "mastra";
    readonly methods: readonly [{
        readonly name: "workflowStepStart";
        readonly eventType: "ActivityStarted";
        readonly activityType: "workflow-step-start";
    }, {
        readonly name: "workflowStepFinish";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "workflow-step-finish";
    }, {
        readonly name: "workflowStepProgress";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "workflow-step-progress";
    }, {
        readonly name: "toolCall";
        readonly eventType: "ActivityStarted";
        readonly activityType: "tool-call";
    }, {
        readonly name: "toolResult";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "tool-result";
    }, {
        readonly name: "error";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "error";
    }];
}, {
    readonly preset: "modern-treasury";
    readonly methods: readonly [{
        readonly name: "paymentOrderApproved";
        readonly eventType: "ActivityStarted";
        readonly activityType: "payment_order.approved";
    }, {
        readonly name: "paymentOrderBeginProcessing";
        readonly eventType: "ActivityStarted";
        readonly activityType: "payment_order.begin_processing";
    }, {
        readonly name: "paymentOrderFailed";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "payment_order.failed";
    }, {
        readonly name: "paymentOrderReconciled";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "payment_order.reconciled";
    }, {
        readonly name: "paymentReferenceCreated";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "payment_reference.created";
    }];
}, {
    readonly preset: "n8n";
    readonly methods: readonly [{
        readonly name: "nodePreExecute";
        readonly eventType: "ActivityStarted";
        readonly activityType: "node-pre-execute";
    }, {
        readonly name: "nodePostExecute";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "node-post-execute";
    }, {
        readonly name: "errorTrigger";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "error-trigger";
    }];
}, {
    readonly preset: "pagerduty";
    readonly methods: readonly [{
        readonly name: "incidentTriggered";
        readonly eventType: "ActivityStarted";
        readonly activityType: "incident.triggered";
    }, {
        readonly name: "incidentAcknowledged";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "incident.acknowledged";
    }, {
        readonly name: "incidentEscalated";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "incident.escalated";
    }, {
        readonly name: "incidentReassigned";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "incident.reassigned";
    }, {
        readonly name: "incidentDelegated";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "incident.delegated";
    }, {
        readonly name: "incidentPriorityUpdated";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "incident.priority_updated";
    }, {
        readonly name: "incidentResolved";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "incident.resolved";
    }, {
        readonly name: "incidentReopened";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "incident.reopened";
    }, {
        readonly name: "incidentUnacknowledged";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "incident.unacknowledged";
    }, {
        readonly name: "incidentAnnotated";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "incident.annotated";
    }];
}, {
    readonly preset: "pydantic-ai";
    readonly methods: readonly [{
        readonly name: "userPromptNode";
        readonly eventType: "ActivityStarted";
        readonly activityType: "UserPromptNode";
    }, {
        readonly name: "modelRequestNode";
        readonly eventType: "ActivityStarted";
        readonly activityType: "ModelRequestNode";
    }, {
        readonly name: "callToolsNode";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "CallToolsNode";
    }, {
        readonly name: "end";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "End";
    }, {
        readonly name: "outputValidator";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "output_validator";
    }, {
        readonly name: "toolRetry";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "tool_retry";
    }];
}, {
    readonly preset: "semantic-kernel";
    readonly methods: readonly [{
        readonly name: "functionInvocationPre";
        readonly eventType: "ActivityStarted";
        readonly activityType: "function_invocation_pre";
    }, {
        readonly name: "functionInvocationPost";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "function_invocation_post";
    }, {
        readonly name: "promptRenderPre";
        readonly eventType: "ActivityStarted";
        readonly activityType: "prompt_render_pre";
    }, {
        readonly name: "promptRenderPost";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "prompt_render_post";
    }, {
        readonly name: "autoFunctionInvocationPre";
        readonly eventType: "ActivityStarted";
        readonly activityType: "auto_function_invocation_pre";
    }, {
        readonly name: "autoFunctionInvocationPost";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "auto_function_invocation_post";
    }];
}, {
    readonly preset: "temporal";
    readonly methods: readonly [{
        readonly name: "activityTaskScheduled";
        readonly eventType: "ActivityStarted";
        readonly activityType: "ActivityTaskScheduled";
    }, {
        readonly name: "activityTaskStarted";
        readonly eventType: "ActivityStarted";
        readonly activityType: "ActivityTaskStarted";
    }, {
        readonly name: "activityTaskCompleted";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "ActivityTaskCompleted";
    }, {
        readonly name: "activityTaskFailed";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "ActivityTaskFailed";
    }, {
        readonly name: "activityTaskTimedOut";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "ActivityTaskTimedOut";
    }, {
        readonly name: "activityTaskCanceled";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "ActivityTaskCanceled";
    }, {
        readonly name: "childWorkflowExecutionInitiated";
        readonly eventType: "ActivityStarted";
        readonly activityType: "ChildWorkflowExecutionInitiated";
    }, {
        readonly name: "childWorkflowExecutionCompleted";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "ChildWorkflowExecutionCompleted";
    }, {
        readonly name: "workflowExecutionSignaled";
        readonly eventType: "SignalReceived";
        readonly activityType: "WorkflowExecutionSignaled";
    }, {
        readonly name: "markerRecorded";
        readonly eventType: "SignalReceived";
        readonly activityType: "MarkerRecorded";
    }, {
        readonly name: "timerStarted";
        readonly eventType: "SignalReceived";
        readonly activityType: "TimerStarted";
    }, {
        readonly name: "timerFired";
        readonly eventType: "SignalReceived";
        readonly activityType: "TimerFired";
    }];
}, {
    readonly preset: "vercel-ai";
    readonly methods: readonly [{
        readonly name: "onStepFinish";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "onStepFinish";
    }, {
        readonly name: "onFinish";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "onFinish";
    }, {
        readonly name: "onError";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "onError";
    }, {
        readonly name: "onAbort";
        readonly eventType: "ActivityCompleted";
        readonly activityType: "onAbort";
    }];
}];
type PresetName = (typeof PRESET_MANIFEST)[number]["preset"];
/** The 6 canonical event_type strings. Anything else on the wire
 *  is a protocol bug. Consumed by the session-inspect protocol
 *  checker + the verify static linter. */
declare const CANONICAL_EVENT_TYPES: ReadonlySet<CanonicalEventType>;
/** Every activity_type string declared in any @preset method or
 *  @activityRouting adapter table. Activity_type is free-form on
 *  the wire (custom agents legitimately emit custom names); this
 *  is the *first-party* vocabulary, useful for guardrail authors
 *  and conformance reports. */
declare const CANONICAL_ACTIVITY_TYPES: ReadonlySet<string>;
/** Spec-driven display label for each canonical activity_type.
 *  Source of truth for any UI that renders activity types
 *  (mobile, web dashboard, CLI list views, audit reports). Consumers
 *  fall back to a Title-Case formatter for activity_types not in
 *  this table; custom-preset domain agents emit free-form strings
 *  that legitimately aren't covered here. */
declare const CANONICAL_ACTIVITY_LABELS: Readonly<Record<string, string>>;
/**
 * Construction options for any preset Session class. The `core` client
 * is the authenticated transport; the other fields define this workflow
 * run's identity. The runtime owns the lifecycle; Workflow{Started,
 * Completed,Failed} fire automatically on `govern()` enter/exit/throw,
 * and via process-exit handlers if the session is still open at exit.
 */
interface GovernedSessionConfig {
    core: OpenBoxCoreClient;
    /** Stable identifier for this workflow run. */
    workflowId?: string;
    /** Per-attempt run identifier. */
    runId?: string;
    /** Workflow-class identifier surfaced to observability. */
    workflowType?: string;
    /** Originating runtime tag (`langgraph` / `temporal` / `mastra` / ...). */
    taskQueue?: string;
    /**
     * Initial polling interval (ms) when the verdict is `require_approval`.
     * The runtime exponentially backs this off (× factor) up to a cap on
     * each attempt so a fast decision doesn't waste a long sleep, but a
     * slow decision doesn't pound core. Default: 500ms.
     */
    approvalPollIntervalMs?: number;
    /**
     * Cap (ms) on the per-attempt poll interval after backoff. Default: 5000ms.
     * The actual sleep is also bounded by min(approvalMaxWaitMs, approvalExpiresAt)
     * so we never overshoot the deadline.
     */
    approvalPollMaxIntervalMs?: number;
    /**
     * Multiplier applied to the poll interval after each attempt. 1.0 = no
     * backoff (fixed interval). Default: 1.5 (gentle exponential).
     */
    approvalPollBackoffFactor?: number;
    /**
     * Random jitter applied to each poll interval as a fraction of the
     * computed interval. 0.25 means ±25%. Default: 0.25. Avoids
     * thundering-herd when a fleet of agents wait on the same approval.
     */
    approvalPollJitter?: number;
    /** Maximum total wait (ms) for an approval decision. Default: 60_000ms. */
    approvalMaxWaitMs?: number;
    /**
     * When true, `runActivity` skips the in-process poll loop on a
     * `require_approval` verdict and returns it straight to the
     * caller. Hook adapters (claude-code, cursor) render that through
     * their `permission-decision` verdict shape into
     * `permissionDecision: 'ask'`, which pops the host's native
     * permission dialog inline. The local user becomes the approver;
     * external approval clients such as the dashboard, mobile app, or
     * editor extension can still resolve the backend row, but the SDK
     * no longer waits for them. Adapters wire this from the
     * `APPROVAL_MODE` config (`inline` -> true,
     * `remote` or unset -> false). Default: false.
     */
    inlineApproval?: boolean;
    /**
     * If true, register process-exit handlers (SIGINT/SIGTERM/uncaughtException
     * /unhandledRejection/beforeExit) that fire `WorkflowFailed` best-effort
     * before the process dies. Default: true. Set false for short-lived
     * scripts where the cleanup is wasteful.
     */
    registerExitHandlers?: boolean;
    /**
     * Internal flag set by `govern.attach()`. When true, the session starts
     * in the `opened` state; `runActivity` will NOT auto-fire WorkflowStarted,
     * and explicit `workflowStarted()` calls become no-ops (idempotent).
     * The parent process is assumed to have already fired the workflow open
     * event. Don't set this manually; use `govern.attach()`.
     */
    attached?: boolean;
    /**
     * Fired the moment the backend returns a `require_approval` verdict
     * with an `approval_id`; BEFORE pollApproval starts the long wait.
     * Lets harnesses (cursor-hooks, claude-hooks) surface inline approval
     * UI in their host IDE without first burning the full poll deadline.
     * Errors thrown here are swallowed; this hook is observability, not
     * a gate.
     */
    onPendingApproval?: (info: {
        approvalId: string;
        /** Backend's governance_event_id; cross-reference to the Approval row's event_id. */
        governanceEventId?: string;
        activityId: string;
        activityType: string;
        expiresAt?: string;
        reason?: string;
    }) => void | Promise<void>;
    /**
     * Fired when pollApproval resolves (decision came back) OR times out
     * (no decision; arm stays `require_approval`). Lets harnesses clear
     * any UI / pending markers they staged in onPendingApproval.
     */
    onApprovalResolved?: (info: {
        approvalId: string;
        activityId: string;
        activityType: string;
        /** 'allow' | 'block' | 'halt' | 'require_approval' (timeout). */
        arm: string;
    }) => void | Promise<void>;
    /**
     * Optional out-of-band decision channel for harnesses that have a
     * faster path than HTTP polling (e.g. a local IPC socket from a UI
     * extension). Called with the same metadata as onPendingApproval and
     * returns a promise that resolves to a final arm when an external
     * source has the decision. The poll loop races this against its
     * normal HTTP cycle and takes whichever finishes first.
     *
     * If the promise rejects or resolves to undefined, the poll loop
     * continues uninterrupted. If it resolves to an arm, the SDK does
     * one confirmatory pollApproval() to read the authoritative verdict
     * from the backend (the external signal might be stale or have
     * arrived in parallel with the backend mutation), then returns.
     */
    awaitExternalDecision?: (info: {
        approvalId: string;
        governanceEventId?: string;
        activityId: string;
        activityType: string;
        expiresAt?: string;
    }) => Promise<'approve' | 'reject' | undefined>;
}
/** Thrown when a session method is called after workflow termination. */
declare class SessionAlreadyTerminatedError extends Error {
    constructor();
}
/**
 * Lifecycle-owning base class. Every preset Session class extends this
 * and delegates its public methods to `runActivity()`. User code never
 * calls `begin()` / `complete()` / `fail()` directly; the `govern()`
 * helper drives them via try/finally.
 */
declare class BaseGovernedSession {
    readonly workflowId: string;
    readonly runId: string;
    readonly workflowType: string;
    readonly taskQueue: string;
    protected readonly core: OpenBoxCoreClient;
    private readonly approvalPollIntervalMs;
    private readonly approvalPollMaxIntervalMs;
    private readonly approvalPollBackoffFactor;
    private readonly approvalPollJitter;
    private readonly approvalMaxWaitMs;
    private readonly inlineApproval;
    private opened;
    private finalized;
    private readonly autoOpenSuppressed;
    private readonly inFlight;
    private readonly activityStartsMs;
    private readonly exitHandlerCleanup;
    protected readonly onPendingApproval?: GovernedSessionConfig['onPendingApproval'];
    protected readonly onApprovalResolved?: GovernedSessionConfig['onApprovalResolved'];
    protected readonly awaitExternalDecision?: GovernedSessionConfig['awaitExternalDecision'];
    constructor(config: GovernedSessionConfig);
    /** True once `begin()` has been called. */
    get isOpen(): boolean;
    /** True after a terminal event (Workflow{Completed,Failed}) fired. */
    get isTerminated(): boolean;
    /**
     * Fire WorkflowStarted. Idempotent; safe to call multiple times,
     * only the first emits. Public so harness-owned consumers (claude-hooks,
     * cursor-hooks) can drive lifecycle when the workflow spans processes.
     * `govern()` calls this automatically before the body runs;
     * `govern.attach()` does NOT; caller decides when (if ever).
     *
     * Backward-compat alias: `begin()`.
     */
    workflowStarted(): Promise<void>;
    /** @deprecated use `workflowStarted()`; same behavior. */
    begin(): Promise<void>;
    /**
     * Fire WorkflowCompleted. Idempotent. Same public/cross-process
     * rationale as `workflowStarted`. `govern()` calls this on the
     * happy-path return from the body; `govern.attach()` does NOT.
     *
     * Backward-compat alias: `complete()`.
     */
    workflowCompleted(): Promise<WorkflowVerdict | undefined>;
    /** @deprecated use `workflowCompleted()`; same behavior. */
    complete(): Promise<WorkflowVerdict | undefined>;
    /**
     * Fire WorkflowFailed with an error payload. Idempotent. `govern()`
     * calls this if the body throws or if a process-exit handler fires;
     * `govern.attach()` does NOT; caller invokes explicitly on harness-
     * signaled session failure.
     *
     * Backward-compat alias: `fail()`.
     */
    workflowFailed(error?: unknown): Promise<WorkflowVerdict | undefined>;
    /** @deprecated use `workflowFailed()`; same behavior. */
    fail(error?: unknown): Promise<WorkflowVerdict | undefined>;
    /**
     * Public escape for firing arbitrary (eventType, activityType, payload)
     * tuples beyond what the bound preset's typed methods cover. Used by
     * runtime adapters (claude-hooks / cursor-hooks) when one hook event
     * needs to dispatch to multiple activity_types based on internal
     * routing; e.g. Claude's PreToolUse hook fires FileRead, FileEdit,
     * ShellExecution etc. depending on `tool_name`.
     *
     * Mirrors the `custom` preset's free-form `activity()`. Same lifecycle
     * invariants (workflow open, paired Start/Complete, idempotent terminal).
     */
    activity(eventType: 'ActivityStarted' | 'ActivityCompleted' | 'SignalReceived', activityType: string, payload: GovernedPayload): Promise<WorkflowVerdict>;
    /**
     * Split-stage activity for callers that must run business logic between
     * the input gate and the output gate (e.g. governed tools that gate the
     * produced artifact). Emits ActivityStarted and returns the gate verdict
     * plus a `complete()` bound to the same activity id, so the pair cannot
     * drift apart. Stopped starts (block/halt) and pending approvals are
     * canonically left unpaired; the caller resolves them via the workflow
     * terminal or approval resume (ActivityCompleted with this activity id).
     */
    openActivity(activityType: string, payload: GovernedPayload): Promise<{
        activityId: string;
        verdict: WorkflowVerdict;
        complete(payload: GovernedPayload, completionActivityType?: string): Promise<WorkflowVerdict>;
    }>;
    /**
     * Run one activity through the canonical envelope. Preset classes
     * call this with their fixed (eventType, activityType) tuple; the
     * `custom` preset takes them from the user.
     *
     * Strategy depends on `eventType`:
     *   ActivityStarted   → emit start; pre-stage block → no completion fired.
     *                       Otherwise emit a paired ActivityCompleted.
     *   ActivityCompleted → emit completion only (post-stage observe / gate).
     *   SignalReceived    → fire-and-forget telemetry (no gate).
     */
    protected runActivity(eventType: 'ActivityStarted' | 'ActivityCompleted' | 'SignalReceived', activityType: string, payload: GovernedPayload): Promise<WorkflowVerdict>;
    private emitCompleted;
    private emitWithSpanHook;
    private emit;
    private pollApproval;
    /**
     * Best-effort handlers for process death. SIGINT/SIGTERM/uncaught
     * exceptions get a brief async window to fire WorkflowFailed; `exit`
     * is synchronous-only so we just log a warning. Multiple sessions in
     * the same process each register their own handlers; cleanup on
     * normal completion removes them.
     */
    private installExitHandlers;
    private cleanupExitHandlers;
}
/** Session for the `airflow` preset; methods match the framework's hook names. */
declare class AirflowSession extends BaseGovernedSession {
    onExecuteCallback(payload: GovernedPayload): Promise<WorkflowVerdict>;
    onSuccessCallback(payload: GovernedPayload): Promise<WorkflowVerdict>;
    onFailureCallback(payload: GovernedPayload): Promise<WorkflowVerdict>;
    onRetryCallback(payload: GovernedPayload): Promise<WorkflowVerdict>;
    slaMissCallback(payload: GovernedPayload): Promise<WorkflowVerdict>;
    onSkippedCallback(payload: GovernedPayload): Promise<WorkflowVerdict>;
}
/** Session for the `argocd` preset; methods match the framework's hook names. */
declare class ArgocdSession extends BaseGovernedSession {
    operationStarted(payload: GovernedPayload): Promise<WorkflowVerdict>;
    operationCompleted(payload: GovernedPayload): Promise<WorkflowVerdict>;
    resourceUpdated(payload: GovernedPayload): Promise<WorkflowVerdict>;
    preSyncHookStarted(payload: GovernedPayload): Promise<WorkflowVerdict>;
    preSyncHookSucceeded(payload: GovernedPayload): Promise<WorkflowVerdict>;
    syncStatusChanged(payload: GovernedPayload): Promise<WorkflowVerdict>;
}
/** Session for the `autogen` preset; methods match the framework's hook names. */
declare class AutogenSession extends BaseGovernedSession {
    textMessage(payload: GovernedPayload): Promise<WorkflowVerdict>;
    multiModalMessage(payload: GovernedPayload): Promise<WorkflowVerdict>;
    toolCallRequestEvent(payload: GovernedPayload): Promise<WorkflowVerdict>;
    toolCallExecutionEvent(payload: GovernedPayload): Promise<WorkflowVerdict>;
    memoryQueryEvent(payload: GovernedPayload): Promise<WorkflowVerdict>;
    userInputRequestedEvent(payload: GovernedPayload): Promise<WorkflowVerdict>;
    handoffMessage(payload: GovernedPayload): Promise<WorkflowVerdict>;
    stopMessage(payload: GovernedPayload): Promise<WorkflowVerdict>;
}
/** Session for the `claude-code` preset; methods match the framework's hook names. */
declare class ClaudeCodeSession extends BaseGovernedSession {
    preToolUse(payload: GovernedPayload): Promise<WorkflowVerdict>;
    postToolUse(payload: GovernedPayload): Promise<WorkflowVerdict>;
    userPromptSubmit(payload: GovernedPayload): Promise<WorkflowVerdict>;
    permissionRequest(payload: GovernedPayload): Promise<WorkflowVerdict>;
    preCompact(payload: GovernedPayload): Promise<WorkflowVerdict>;
    subagentStop(payload: GovernedPayload): Promise<WorkflowVerdict>;
    notification(payload: GovernedPayload): Promise<WorkflowVerdict>;
    stop(payload: GovernedPayload): Promise<WorkflowVerdict>;
}
/** Session for the `cline` preset; methods match the framework's hook names. */
declare class ClineSession extends BaseGovernedSession {
    preToolUse(payload: GovernedPayload): Promise<WorkflowVerdict>;
    postToolUse(payload: GovernedPayload): Promise<WorkflowVerdict>;
    userPromptSubmit(payload: GovernedPayload): Promise<WorkflowVerdict>;
    taskStart(payload: GovernedPayload): Promise<WorkflowVerdict>;
}
/** Session for the `codex` preset; methods match the framework's hook names. */
declare class CodexSession extends BaseGovernedSession {
    userPromptSubmit(payload: GovernedPayload): Promise<WorkflowVerdict>;
    preToolUse(payload: GovernedPayload): Promise<WorkflowVerdict>;
    permissionRequest(payload: GovernedPayload): Promise<WorkflowVerdict>;
    postToolUse(payload: GovernedPayload): Promise<WorkflowVerdict>;
    stop(payload: GovernedPayload): Promise<WorkflowVerdict>;
}
/** Session for the `copilot` preset; methods match the framework's hook names. */
declare class CopilotSession extends BaseGovernedSession {
    userPromptSubmitted(payload: GovernedPayload): Promise<WorkflowVerdict>;
    preToolUse(payload: GovernedPayload): Promise<WorkflowVerdict>;
    postToolUse(payload: GovernedPayload): Promise<WorkflowVerdict>;
    agentStop(payload: GovernedPayload): Promise<WorkflowVerdict>;
    subagentStop(payload: GovernedPayload): Promise<WorkflowVerdict>;
    errorOccurred(payload: GovernedPayload): Promise<WorkflowVerdict>;
}
/** Session for the `crewai` preset; methods match the framework's hook names. */
declare class CrewaiSession extends BaseGovernedSession {
    crewKickoffStarted(payload: GovernedPayload): Promise<WorkflowVerdict>;
    crewKickoffCompleted(payload: GovernedPayload): Promise<WorkflowVerdict>;
    agentExecutionStarted(payload: GovernedPayload): Promise<WorkflowVerdict>;
    agentExecutionCompleted(payload: GovernedPayload): Promise<WorkflowVerdict>;
    taskStarted(payload: GovernedPayload): Promise<WorkflowVerdict>;
    taskCompleted(payload: GovernedPayload): Promise<WorkflowVerdict>;
    toolUsageStarted(payload: GovernedPayload): Promise<WorkflowVerdict>;
    toolUsageFinished(payload: GovernedPayload): Promise<WorkflowVerdict>;
    toolUsageError(payload: GovernedPayload): Promise<WorkflowVerdict>;
    llmCallStarted(payload: GovernedPayload): Promise<WorkflowVerdict>;
    llmCallCompleted(payload: GovernedPayload): Promise<WorkflowVerdict>;
}
/** Session for the `cursor` preset; methods match the framework's hook names. */
declare class CursorSession extends BaseGovernedSession {
    beforeSubmitPrompt(payload: GovernedPayload): Promise<WorkflowVerdict>;
    preToolUse(payload: GovernedPayload): Promise<WorkflowVerdict>;
    postToolUse(payload: GovernedPayload): Promise<WorkflowVerdict>;
    beforeShellExecution(payload: GovernedPayload): Promise<WorkflowVerdict>;
    afterShellExecution(payload: GovernedPayload): Promise<WorkflowVerdict>;
    beforeMCPExecution(payload: GovernedPayload): Promise<WorkflowVerdict>;
    afterMCPExecution(payload: GovernedPayload): Promise<WorkflowVerdict>;
    beforeReadFile(payload: GovernedPayload): Promise<WorkflowVerdict>;
    afterFileEdit(payload: GovernedPayload): Promise<WorkflowVerdict>;
    afterAgentResponse(payload: GovernedPayload): Promise<WorkflowVerdict>;
    afterAgentThought(payload: GovernedPayload): Promise<WorkflowVerdict>;
}
/** Free-form session; caller supplies activity_type + stage at call time. */
declare class CustomSession extends BaseGovernedSession {
    /**
     * Run an arbitrary activity. The runtime stamps:
     *   stage="pre"  → event_type=ActivityStarted
     *   stage="post" → event_type=ActivityCompleted
     */
    activity(activityType: string, stage: ActivityStage, payload: GovernedPayload): Promise<WorkflowVerdict>;
}
/** Session for the `default` preset; methods match the framework's hook names. */
declare class DefaultSession extends BaseGovernedSession {
    prompt(payload: GovernedPayload): Promise<WorkflowVerdict>;
    llm(payload: GovernedPayload): Promise<WorkflowVerdict>;
    tool(payload: GovernedPayload): Promise<WorkflowVerdict>;
    toolCompleted(payload: GovernedPayload): Promise<WorkflowVerdict>;
    read(payload: GovernedPayload): Promise<WorkflowVerdict>;
    write(payload: GovernedPayload): Promise<WorkflowVerdict>;
    fileDelete(payload: GovernedPayload): Promise<WorkflowVerdict>;
    shell(payload: GovernedPayload): Promise<WorkflowVerdict>;
    httpRequest(payload: GovernedPayload): Promise<WorkflowVerdict>;
    mcpToolCall(payload: GovernedPayload): Promise<WorkflowVerdict>;
    agentSpawn(payload: GovernedPayload): Promise<WorkflowVerdict>;
}
/** Session for the `langchain` preset; methods match the framework's hook names. */
declare class LangchainSession extends BaseGovernedSession {
    onLlmStart(payload: GovernedPayload): Promise<WorkflowVerdict>;
    onLlmEnd(payload: GovernedPayload): Promise<WorkflowVerdict>;
    onLlmError(payload: GovernedPayload): Promise<WorkflowVerdict>;
    onChatModelStart(payload: GovernedPayload): Promise<WorkflowVerdict>;
    onToolStart(payload: GovernedPayload): Promise<WorkflowVerdict>;
    onToolEnd(payload: GovernedPayload): Promise<WorkflowVerdict>;
    onToolError(payload: GovernedPayload): Promise<WorkflowVerdict>;
    onChainStart(payload: GovernedPayload): Promise<WorkflowVerdict>;
    onChainEnd(payload: GovernedPayload): Promise<WorkflowVerdict>;
    onAgentAction(payload: GovernedPayload): Promise<WorkflowVerdict>;
    onAgentFinish(payload: GovernedPayload): Promise<WorkflowVerdict>;
    onRetrieverStart(payload: GovernedPayload): Promise<WorkflowVerdict>;
    onRetrieverEnd(payload: GovernedPayload): Promise<WorkflowVerdict>;
}
/** Session for the `langgraph` preset; methods match the framework's hook names. */
declare class LanggraphSession extends BaseGovernedSession {
    nodeStart(payload: GovernedPayload): Promise<WorkflowVerdict>;
    nodeEnd(payload: GovernedPayload): Promise<WorkflowVerdict>;
    interrupt(payload: GovernedPayload): Promise<WorkflowVerdict>;
    checkpoint(payload: GovernedPayload): Promise<WorkflowVerdict>;
    taskStart(payload: GovernedPayload): Promise<WorkflowVerdict>;
    taskEnd(payload: GovernedPayload): Promise<WorkflowVerdict>;
    customEvent(payload: GovernedPayload): Promise<WorkflowVerdict>;
}
/** Session for the `llamaindex` preset; methods match the framework's hook names. */
declare class LlamaindexSession extends BaseGovernedSession {
    chunking(payload: GovernedPayload): Promise<WorkflowVerdict>;
    llm(payload: GovernedPayload): Promise<WorkflowVerdict>;
    query(payload: GovernedPayload): Promise<WorkflowVerdict>;
    retrieve(payload: GovernedPayload): Promise<WorkflowVerdict>;
    synthesize(payload: GovernedPayload): Promise<WorkflowVerdict>;
    embedding(payload: GovernedPayload): Promise<WorkflowVerdict>;
    functionCall(payload: GovernedPayload): Promise<WorkflowVerdict>;
    agentStep(payload: GovernedPayload): Promise<WorkflowVerdict>;
    reranking(payload: GovernedPayload): Promise<WorkflowVerdict>;
    subQuestion(payload: GovernedPayload): Promise<WorkflowVerdict>;
    exception(payload: GovernedPayload): Promise<WorkflowVerdict>;
}
/** Session for the `mastra` preset; methods match the framework's hook names. */
declare class MastraSession extends BaseGovernedSession {
    workflowStepStart(payload: GovernedPayload): Promise<WorkflowVerdict>;
    workflowStepFinish(payload: GovernedPayload): Promise<WorkflowVerdict>;
    workflowStepProgress(payload: GovernedPayload): Promise<WorkflowVerdict>;
    toolCall(payload: GovernedPayload): Promise<WorkflowVerdict>;
    toolResult(payload: GovernedPayload): Promise<WorkflowVerdict>;
    error(payload: GovernedPayload): Promise<WorkflowVerdict>;
}
/** Session for the `modern-treasury` preset; methods match the framework's hook names. */
declare class ModernTreasurySession extends BaseGovernedSession {
    paymentOrderApproved(payload: GovernedPayload): Promise<WorkflowVerdict>;
    paymentOrderBeginProcessing(payload: GovernedPayload): Promise<WorkflowVerdict>;
    paymentOrderFailed(payload: GovernedPayload): Promise<WorkflowVerdict>;
    paymentOrderReconciled(payload: GovernedPayload): Promise<WorkflowVerdict>;
    paymentReferenceCreated(payload: GovernedPayload): Promise<WorkflowVerdict>;
}
/** Session for the `n8n` preset; methods match the framework's hook names. */
declare class N8nSession extends BaseGovernedSession {
    nodePreExecute(payload: GovernedPayload): Promise<WorkflowVerdict>;
    nodePostExecute(payload: GovernedPayload): Promise<WorkflowVerdict>;
    errorTrigger(payload: GovernedPayload): Promise<WorkflowVerdict>;
}
/** Session for the `pagerduty` preset; methods match the framework's hook names. */
declare class PagerdutySession extends BaseGovernedSession {
    incidentTriggered(payload: GovernedPayload): Promise<WorkflowVerdict>;
    incidentAcknowledged(payload: GovernedPayload): Promise<WorkflowVerdict>;
    incidentEscalated(payload: GovernedPayload): Promise<WorkflowVerdict>;
    incidentReassigned(payload: GovernedPayload): Promise<WorkflowVerdict>;
    incidentDelegated(payload: GovernedPayload): Promise<WorkflowVerdict>;
    incidentPriorityUpdated(payload: GovernedPayload): Promise<WorkflowVerdict>;
    incidentResolved(payload: GovernedPayload): Promise<WorkflowVerdict>;
    incidentReopened(payload: GovernedPayload): Promise<WorkflowVerdict>;
    incidentUnacknowledged(payload: GovernedPayload): Promise<WorkflowVerdict>;
    incidentAnnotated(payload: GovernedPayload): Promise<WorkflowVerdict>;
}
/** Session for the `pydantic-ai` preset; methods match the framework's hook names. */
declare class PydanticAiSession extends BaseGovernedSession {
    userPromptNode(payload: GovernedPayload): Promise<WorkflowVerdict>;
    modelRequestNode(payload: GovernedPayload): Promise<WorkflowVerdict>;
    callToolsNode(payload: GovernedPayload): Promise<WorkflowVerdict>;
    end(payload: GovernedPayload): Promise<WorkflowVerdict>;
    outputValidator(payload: GovernedPayload): Promise<WorkflowVerdict>;
    toolRetry(payload: GovernedPayload): Promise<WorkflowVerdict>;
}
/** Session for the `semantic-kernel` preset; methods match the framework's hook names. */
declare class SemanticKernelSession extends BaseGovernedSession {
    functionInvocationPre(payload: GovernedPayload): Promise<WorkflowVerdict>;
    functionInvocationPost(payload: GovernedPayload): Promise<WorkflowVerdict>;
    promptRenderPre(payload: GovernedPayload): Promise<WorkflowVerdict>;
    promptRenderPost(payload: GovernedPayload): Promise<WorkflowVerdict>;
    autoFunctionInvocationPre(payload: GovernedPayload): Promise<WorkflowVerdict>;
    autoFunctionInvocationPost(payload: GovernedPayload): Promise<WorkflowVerdict>;
}
/** Session for the `temporal` preset; methods match the framework's hook names. */
declare class TemporalSession extends BaseGovernedSession {
    activityTaskScheduled(payload: GovernedPayload): Promise<WorkflowVerdict>;
    activityTaskStarted(payload: GovernedPayload): Promise<WorkflowVerdict>;
    activityTaskCompleted(payload: GovernedPayload): Promise<WorkflowVerdict>;
    activityTaskFailed(payload: GovernedPayload): Promise<WorkflowVerdict>;
    activityTaskTimedOut(payload: GovernedPayload): Promise<WorkflowVerdict>;
    activityTaskCanceled(payload: GovernedPayload): Promise<WorkflowVerdict>;
    childWorkflowExecutionInitiated(payload: GovernedPayload): Promise<WorkflowVerdict>;
    childWorkflowExecutionCompleted(payload: GovernedPayload): Promise<WorkflowVerdict>;
    workflowExecutionSignaled(payload: GovernedPayload): Promise<WorkflowVerdict>;
    markerRecorded(payload: GovernedPayload): Promise<WorkflowVerdict>;
    timerStarted(payload: GovernedPayload): Promise<WorkflowVerdict>;
    timerFired(payload: GovernedPayload): Promise<WorkflowVerdict>;
}
/** Session for the `vercel-ai` preset; methods match the framework's hook names. */
declare class VercelAiSession extends BaseGovernedSession {
    onStepFinish(payload: GovernedPayload): Promise<WorkflowVerdict>;
    onFinish(payload: GovernedPayload): Promise<WorkflowVerdict>;
    onError(payload: GovernedPayload): Promise<WorkflowVerdict>;
    onAbort(payload: GovernedPayload): Promise<WorkflowVerdict>;
}
/**
 * Registry of every framework preset. Pass one as `config.preset` to
 * `govern()` and the typed session inside the callback will match.
 *
 * ```ts
 * await govern({ core, preset: presets.claudeCode }, async (session) => {
 *   await session.preToolUse({ input: [...] });
 * });
 * ```
 */
declare const presets: {
    readonly airflow: typeof AirflowSession;
    readonly argocd: typeof ArgocdSession;
    readonly autogen: typeof AutogenSession;
    readonly claudeCode: typeof ClaudeCodeSession;
    readonly cline: typeof ClineSession;
    readonly codex: typeof CodexSession;
    readonly copilot: typeof CopilotSession;
    readonly crewai: typeof CrewaiSession;
    readonly cursor: typeof CursorSession;
    readonly custom: typeof CustomSession;
    readonly default: typeof DefaultSession;
    readonly langchain: typeof LangchainSession;
    readonly langgraph: typeof LanggraphSession;
    readonly llamaindex: typeof LlamaindexSession;
    readonly mastra: typeof MastraSession;
    readonly modernTreasury: typeof ModernTreasurySession;
    readonly n8n: typeof N8nSession;
    readonly pagerduty: typeof PagerdutySession;
    readonly pydanticAi: typeof PydanticAiSession;
    readonly semanticKernel: typeof SemanticKernelSession;
    readonly temporal: typeof TemporalSession;
    readonly vercelAi: typeof VercelAiSession;
};
type Presets = typeof presets;
type PresetCtor = Presets[keyof Presets];
/**
 * Attach a session to an existing workflow. For consumers where the
 * harness (Claude Code, Cursor, an external orchestrator) owns the
 * workflow lifecycle and the consumer fires individual activity events
 * across many short-lived processes.
 *
 * Differences vs `govern()`:
 *   - No auto-WorkflowStarted (caller fires `session.workflowStarted()`
 *     explicitly when the harness signals session start).
 *   - No auto-WorkflowCompleted (caller fires it on session end).
 *   - No process-exit handlers by default (a fresh process per hook is
 *     normal flow, not workflow failure).
 *   - `workflowId` and `runId` are REQUIRED on the config; the harness
 *     persists them across processes.
 *
 * ```ts
 * const session = govern.attach({
 *   core, agentId,
 *   preset: presets.claudeCode,
 *   workflowId, runId,         // read from your harness's session store
 * });
 *
 * if (firstHookInSession) await session.workflowStarted();
 * const verdict = await session.preToolUse({ input: [...] });
 * if (lastHookInSession) await session.workflowCompleted();
 * ```
 */
declare function governAttach<S extends PresetCtor>(config: Omit<GovernedSessionConfig, 'workflowId' | 'runId' | 'registerExitHandlers'> & {
    preset: S;
    workflowId: string;
    runId: string;
    /** Default `false`; fresh-process-per-hook is normal flow, not failure. */
    registerExitHandlers?: boolean;
}): InstanceType<S>;
/**
 * Open a workflow envelope, run `body` with the typed session, and
 * finalize (Workflow{Completed,Failed}) on return; even if `body`
 * throws. Process-exit handlers fire WorkflowFailed best-effort if the
 * runtime dies mid-session.
 *
 * For single-process consumers (mobile, extension, MCP, custom Node).
 * For cross-process / harness-owned workflows (claude-hooks, cursor-hooks)
 * use `govern.attach()` instead.
 *
 * ```ts
 * await govern({ core, preset: presets.claudeCode }, async (session) => {
 *   await session.preToolUse({ input: [...] });
 * });
 * ```
 */
declare function govern<S extends PresetCtor, T>(config: GovernedSessionConfig & {
    preset: S;
}, body: (session: InstanceType<S>) => Promise<T>): Promise<T>;
declare namespace govern {
    const attach: typeof governAttach;
}

export { type ActivityStage as A, BaseGovernedSession as B, type CanonicalEventType as C, DefaultSession as D, type GuardrailsVerdict as E, LanggraphSession as F, type GovernedPayload as G, LlamaindexSession as H, ModernTreasurySession as I, PagerdutySession as J, PydanticAiSession as K, LangchainSession as L, MastraSession as M, N8nSession as N, OpenBoxCoreClient as O, PRESET_MANIFEST as P, SemanticKernelSession as Q, VercelAiSession as R, SessionAlreadyTerminatedError as S, TemporalSession as T, signAgentIdentityRequest as U, type VerdictArm as V, type WorkflowVerdict as W, type CanonicalVerdict as a, CoreApiError as b, type CoreClientConfig as c, type GovernedSessionConfig as d, type PresetCtor as e, type PresetName as f, type Presets as g, govern as h, type AgentIdentityConfig as i, AirflowSession as j, ArgocdSession as k, AutogenSession as l, type BehavioralResult as m, CANONICAL_ACTIVITY_LABELS as n, CANONICAL_ACTIVITY_TYPES as o, presets as p, CANONICAL_EVENT_TYPES as q, ClaudeCodeSession as r, ClineSession as s, CodexSession as t, CopilotSession as u, CrewaiSession as v, CursorSession as w, CustomSession as x, type GuardrailFieldVerdict as y, type GuardrailReasonRef as z };
