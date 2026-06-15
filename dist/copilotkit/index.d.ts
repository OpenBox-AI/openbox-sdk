type Verdict = "allow" | "constrain" | "require_approval" | "block" | "halt";
type LegacyAction = "allow" | "constrain" | "require_approval" | "block" | "halt" | "continue" | "stop";
type EventType = "WorkflowStarted" | "WorkflowCompleted" | "WorkflowFailed" | "ActivityStarted" | "ActivityCompleted" | "SignalReceived";
interface GovernanceEventPayload {
    source: string;
    event_type: EventType;
    workflow_id: string;
    run_id: string;
    workflow_type: string;
    task_queue: "langgraph" | "temporal" | "mastra" | "claude-code" | "cursor" | "generic";
    timestamp: string;
    sdk_version?: string;
    parent_workflow_id?: string;
    status?: "completed" | "failed" | "cancelled" | "terminated";
    activity_id?: string;
    activity_type?: string;
    attempt?: number;
    activity_input?: unknown[] | {};
    activity_output?: unknown;
    signal_name?: string;
    signal_args?: unknown;
    start_time?: number;
    end_time?: number;
    duration_ms?: number;
    span_count?: number;
    spans?: SpanData[];
    hook_trigger?: boolean;
    error?: ErrorInfo;
}
interface SpanData {
    span_id: string;
    trace_id: string;
    parent_span_id?: string;
    name: string;
    kind?: string;
    start_time: number;
    end_time: number;
    duration_ns?: number;
    attributes?: Record<string, unknown>;
    status?: SpanStatus;
    events?: SpanEvent[];
    request_headers?: Record<string, string>;
    response_headers?: Record<string, string>;
    request_body?: string;
    response_body?: string;
    semantic_type?: string;
    stage?: "started" | "completed";
    data?: unknown;
    hook_type?: "http_request" | "db_query" | "file_operation" | "function_call";
    attribute_key_identifiers?: string[];
    error?: string;
    http_method?: string;
    http_url?: string;
    http_status_code?: number;
    db_system?: string;
    db_name?: string;
    db_operation?: string;
    db_statement?: string;
    server_address?: string;
    server_port?: number;
    rowcount?: number;
    file_path?: string;
    file_mode?: string;
    file_operation?: string;
    bytes_read?: number;
    bytes_written?: number;
    lines_count?: number;
    function?: string;
    module?: string;
    args?: unknown;
    result?: unknown;
}
interface SpanStatus {
    code: "OK" | "ERROR" | "UNSET";
    description?: string;
}
interface SpanEvent {
    name: string;
    timestamp: number;
    attributes: Record<string, unknown>;
}
interface ErrorInfo {
    type: string;
    message: string;
    stack_trace?: string;
    cause?: ErrorInfo;
    error_type?: string;
    non_retryable?: boolean;
}
interface GovernanceVerdictResponse {
    governance_event_id: string;
    verdict: Verdict;
    risk_score: number;
    action: LegacyAction;
    trust_tier?: number;
    behavioral_violations?: string[];
    approval_id?: string;
    constraints?: string[];
    approval_expiration_time?: string;
    fallback_used: boolean;
    reason?: string;
    policy_id?: string;
    metadata?: Record<string, unknown>;
    guardrails_result?: GuardrailsResult;
    age_result?: AGEResult;
}
interface GuardrailsResult {
    input_type: "activity_input" | "activity_output";
    redacted_input: unknown;
    raw_logs: Record<string, unknown>;
    validation_passed: boolean;
    reasons: GuardrailReason[];
    results: GuardrailsVerdictResult[];
}
interface GuardrailReason {
    type: string;
    field: string;
    reason: string;
}
interface GuardrailsVerdictResult {
    guardrail_type: string;
    results: GuardrailFieldResult[];
}
interface GuardrailFieldResult {
    field: string;
    order: number;
    status: "allowed" | "blocked" | "redacted" | "skipped";
    reason?: string;
}
interface AGEResult {
    allowed: boolean;
    verdict: Verdict;
    reason?: string;
    goal_alignment_checked: boolean;
    goal_drifted: boolean;
    fallback_used: boolean;
    final_trust_score?: AGETrustScore;
    span_results: AGESpanResult[];
    total_spans: number;
    violations_count: number;
    response_time_ms: number;
}
interface AGETrustScore {
    trust_score: number;
    trust_tier: number;
    behavioral_compliance: number;
    alignment_consistency: number;
    aivss_baseline: number;
}
interface AGESpanResult {
    span_id: string;
    semantic_type: string;
    behavioral_result: unknown;
    alignment_result?: AGEAlignmentResult;
    trust_score_after?: AGETrustScore;
    timestamp: string;
}
interface AGEAlignmentResult {
    is_aligned: boolean;
    score: number;
}
interface ApprovalStatusRequest {
    workflow_id: string;
    run_id: string;
    activity_id: string;
}
interface ApprovalStatusResponse {
    id: string;
    action: LegacyAction;
    reason?: string;
    approval_expiration_time?: string;
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
}

declare const OPENBOX_COPILOTKIT_RESULT_SCHEMA_VERSION: "openbox.copilotkit.result.v1";

type OpenBoxCopilotVerdictStatus = 'executed' | 'constrained' | 'blocked' | 'halted' | 'approval_required' | 'rejected' | 'approval_pending' | 'error';
type OpenBoxCopilotSessionState = {
    status: 'active';
} | {
    status: 'halted';
    reason: string;
    haltedAt: string;
    workflowId?: string;
    runId?: string;
    activityId?: string;
};
interface OpenBoxCopilotActionInput {
    action: string;
    request: string;
    destination?: string;
    amountUsd?: number;
    fields?: string[];
    audience?: string;
    sensitivity?: string;
    [key: string]: unknown;
}
interface OpenBoxCopilotResumeInput extends OpenBoxCopilotActionInput {
    workflowId: string;
    runId: string;
    activityId: string;
    approvalId?: string;
    governanceEventId?: string;
    approved?: boolean;
}
interface OpenBoxCopilotActionResult<TArtifact = unknown> {
    schemaVersion: typeof OPENBOX_COPILOTKIT_RESULT_SCHEMA_VERSION;
    status: OpenBoxCopilotVerdictStatus;
    /**
     * The OpenBox governance arm, or `'error'` when OpenBox could not be
     * reached and the SDK failed closed. `'block'` strictly means a policy
     * decision; availability failures must never claim it.
     */
    verdict: WorkflowVerdict['arm'] | 'error';
    executed: boolean;
    action: string;
    request: string;
    destination: string | null;
    amountUsd: number | null;
    fields: string[] | null;
    audience: string | null;
    sensitivity: string | null;
    reason: string;
    message: string;
    riskScore?: number;
    trustTier?: string | number;
    guardrailsResult?: WorkflowVerdict['guardrailsResult'];
    redactionSummary?: string;
    artifact?: TArtifact;
    workflowId?: string;
    runId?: string;
    activityId?: string;
    approvalId?: string;
    governanceEventId?: string;
    expiresAt?: string;
    session?: OpenBoxCopilotSessionState;
    timings?: OpenBoxCopilotTimings;
    [key: string]: unknown;
}
interface OpenBoxCopilotKitConfig {
    enabled?: boolean;
    strict?: boolean;
    governanceMode?: 'observe' | 'enforce';
    failClosed?: boolean;
    redactionMode?: 'transformed-only';
    core?: OpenBoxCoreClient;
    /** Core runtime URL. Defaults to OPENBOX_CORE_URL. */
    coreUrl?: string;
    /** Runtime agent key used for Core governance. Defaults to OPENBOX_API_KEY. */
    apiKey?: string;
    /** Core request timeout in milliseconds. Defaults to the Core client default. */
    coreTimeoutMs?: number;
    /**
     * Optional signed agent identity returned by Backend `createAgent`.
     * Defaults to OPENBOX_AGENT_DID + OPENBOX_AGENT_PRIVATE_KEY.
     */
    agentIdentity?: AgentIdentityConfig;
    /**
     * Optional platform/backend URL for readiness checks and approval
     * decisions. Runtime governance evaluation does not require it.
     */
    apiUrl?: string;
    /**
     * Backend request timeout in milliseconds for readiness checks and
     * approval decisions. Runtime governance evaluation uses coreTimeoutMs.
     */
    backendTimeoutMs?: number;
    /**
     * Optional platform/backend key for readiness checks and approval
     * decisions. Runtime governance evaluation does not require it.
     */
    backendApiKey?: string;
    /**
     * Optional platform agent ID for readiness checks and approval
     * decisions. Runtime governance evaluation does not require it.
     */
    agentId?: string;
    clientName?: string;
    workflowType?: string;
    agentWorkflowType?: string;
    taskQueue?: string;
    selfGovernedToolNames?: Iterable<string>;
}
interface OpenBoxCopilotRuntimeConfig {
    runtime: Record<string, any>;
    runner?: OpenBoxCopilotAgentRunnerLike;
    adapter?: OpenBoxCopilotKitAdapter;
    agents?: string[];
    finalOutputMode?: 'buffer';
    sessionKey?: (input: OpenBoxCopilotRunInputLike) => string;
}
interface OpenBoxCopilotRuntime {
    runtime: Record<string, any>;
    runner: OpenBoxCopilotAgentRunnerLike;
    hooks: {
        onBeforeHandler(ctx: OpenBoxCopilotRuntimeHookContext): Promise<Request | void>;
        onResponse(ctx: OpenBoxCopilotRuntimeResponseHookContext): Promise<Response | void>;
        onError(ctx: OpenBoxCopilotRuntimeErrorHookContext): Promise<Response | void>;
    };
}
interface OpenBoxCopilotRuntimeHookContext {
    request: Request;
    path: string;
    runtime: Record<string, any>;
    route?: {
        method?: string;
        agentId?: string;
        [key: string]: unknown;
    };
}
interface OpenBoxCopilotRuntimeResponseHookContext extends OpenBoxCopilotRuntimeHookContext {
    response: Response;
}
interface OpenBoxCopilotRuntimeErrorHookContext extends OpenBoxCopilotRuntimeHookContext {
    error: unknown;
}
interface OpenBoxCopilotAgentRunnerLike {
    run(request: OpenBoxCopilotRunnerRunRequest): OpenBoxCopilotObservableLike;
    connect?(request: unknown): unknown;
    isRunning?(request: unknown): Promise<boolean>;
    stop?(request: unknown): Promise<boolean | undefined>;
}
interface OpenBoxCopilotRunnerRunRequest {
    threadId: string;
    agent: unknown;
    input: OpenBoxCopilotRunInputLike;
    [key: string]: unknown;
}
interface OpenBoxCopilotRunInputLike {
    threadId: string;
    runId?: string;
    messages?: Array<Record<string, any>>;
    state?: unknown;
    [key: string]: unknown;
}
interface OpenBoxCopilotObservableLike {
    subscribe(observerOrNext?: unknown, error?: unknown, complete?: unknown): unknown;
    [key: string]: unknown;
}
interface OpenBoxCopilotLangChainMiddlewareDeps {
    createMiddleware: (definition: any) => unknown;
    AIMessage: new (message: any) => unknown;
    /**
     * Optional LangChain middleware state schema (for example a zod object)
     * declaring `openboxWorkflowId`, `openboxRunId`, and the runtime
     * prompt-governed flag. Declaring them keeps the CopilotKit runtime's
     * workflow IDs in LangGraph state so one user task maps to one OpenBox
     * session.
     */
    stateSchema?: unknown;
    /**
     * Optional LangChain middleware context schema (for example a zod object)
     * declaring `openboxWorkflowId`, `openboxRunId`, and
     * `openboxPromptGoverned`. AG-UI forwards matching run-config keys into
     * LangGraph run context, which carries the CopilotKit runtime's workflow
     * IDs across the process boundary.
     */
    contextSchema?: unknown;
    routeLatestUserPrompt?: (messages: unknown[]) => OpenBoxCopilotPromptRoute | undefined;
}
interface OpenBoxCopilotPromptRoute {
    toolName: string;
    args: Record<string, unknown>;
}
type OpenBoxCopilotGateKind = 'prompt' | 'tool_input' | 'tool_output' | 'assistant_output';
interface OpenBoxSafePayload<T = unknown> {
    safe: T;
    verdict: WorkflowVerdict;
    status: OpenBoxCopilotVerdictStatus;
    changed: boolean;
    rawBlocked: boolean;
    reason: string;
    message: string;
    redactionSummary?: string;
    workflowId: string;
    runId: string;
    activityId: string;
    session?: OpenBoxCopilotSessionState;
    timings?: OpenBoxCopilotTimings;
}
type OpenBoxCopilotTimingKind = 'openbox' | 'workflow' | 'tool' | 'model' | 'ui';
interface OpenBoxCopilotTimingStep {
    key: string;
    label: string;
    ms: number;
    kind: OpenBoxCopilotTimingKind;
}
interface OpenBoxCopilotTimingEvent {
    phase: 'started' | 'finished';
    key: string;
    label: string;
    kind: OpenBoxCopilotTimingKind;
    startedAt: string;
    completedAt?: string;
    ms?: number;
}
interface OpenBoxCopilotTimings {
    startedAt?: string;
    completedAt?: string;
    totalMs?: number;
    steps: OpenBoxCopilotTimingStep[];
}
interface OpenBoxCopilotGateInput<T = unknown> {
    payload: T;
    sessionKey?: string;
    workflowId?: string;
    runId?: string;
    activityId?: string;
    activityType?: string;
    reason?: string;
    ensureWorkflowStarted?: boolean;
}
interface GovernedCopilotToolDefinition<TInput extends OpenBoxCopilotActionInput = OpenBoxCopilotActionInput, TArtifact = unknown> {
    adapter: OpenBoxCopilotKitAdapter;
    toolName: string;
    description?: string;
    normalizeInput?: (input: TInput) => TInput;
    execute: (input: TInput) => Promise<TArtifact> | TArtifact;
    spanProfile?: (input: TInput, stage: 'started' | 'completed') => Partial<SpanData> | undefined;
    isArtifactRedacted?: (artifact: TArtifact | undefined) => boolean;
    markArtifactRedacted?: (artifact: TArtifact) => TArtifact;
    sessionKey?: (config?: unknown) => string;
    onTimingEvent?: (event: OpenBoxCopilotTimingEvent, context: {
        input: TInput;
        runtimeConfig?: unknown;
    }) => Promise<void> | void;
}
interface OpenBoxApprovalDecisionRequest {
    governanceEventId?: string;
    workflowId?: string;
    runId?: string;
    activityId?: string;
    decision: 'approve' | 'reject';
}
interface OpenBoxApprovalDecisionResult {
    ok: true;
    decision: 'approve' | 'reject';
    eventId?: string;
}
declare class OpenBoxCopilotKitError extends Error {
    readonly verdict?: WorkflowVerdict;
    constructor(message: string, verdict?: WorkflowVerdict);
}
interface OpenBoxCopilotKitAdapter {
    isEnabled(): boolean;
    getCoreClient(): OpenBoxCoreClient;
    wrapAgent<TAgent>(agent: TAgent): TAgent;
    createLangChainMiddleware(deps: OpenBoxCopilotLangChainMiddlewareDeps): unknown;
    governPrompt<T = unknown>(input: OpenBoxCopilotGateInput<T>): Promise<OpenBoxSafePayload<T>>;
    governToolInput<T = unknown>(input: OpenBoxCopilotGateInput<T>): Promise<OpenBoxSafePayload<T>>;
    governToolOutput<T = unknown>(input: OpenBoxCopilotGateInput<T>): Promise<OpenBoxSafePayload<T>>;
    governAssistantOutput<T = unknown>(input: OpenBoxCopilotGateInput<T>): Promise<OpenBoxSafePayload<T>>;
    applyOpenBoxTransform<T = unknown>(original: T, verdict: WorkflowVerdict): T;
    toOpenBoxCopilotResult<T = unknown>(verdict: WorkflowVerdict, safePayload: OpenBoxSafePayload<T>): OpenBoxCopilotActionResult<T>;
    haltSession(sessionKey: string, session: Extract<OpenBoxCopilotSessionState, {
        status: 'halted';
    }>): void;
    isSessionHalted(sessionKey: string): Extract<OpenBoxCopilotSessionState, {
        status: 'halted';
    }> | undefined;
    governTool<TInput extends OpenBoxCopilotActionInput, TArtifact>(definition: Omit<GovernedCopilotToolDefinition<TInput, TArtifact>, 'adapter'>): GovernedCopilotTool<TInput, TArtifact>;
    approvalRoute: {
        decide(request: OpenBoxApprovalDecisionRequest): Promise<OpenBoxApprovalDecisionResult>;
    };
    rendering: {
        governedToolNames: string[];
        approvalToolName: string;
        interactiveToolName: string;
        isGovernedToolResult(value: unknown): boolean;
        parseToolResult(value: unknown): Record<string, unknown>;
    };
}
interface GovernedCopilotTool<TInput extends OpenBoxCopilotActionInput = OpenBoxCopilotActionInput, TArtifact = unknown> {
    execute(input: TInput, config?: unknown): Promise<OpenBoxCopilotActionResult<TArtifact>>;
    resume(input: TInput & OpenBoxCopilotResumeInput, config?: unknown): Promise<OpenBoxCopilotActionResult<TArtifact>>;
}

declare function createOpenBoxCopilotKitAdapter(config?: OpenBoxCopilotKitConfig): OpenBoxCopilotKitAdapter;

declare function createGovernedCopilotTool<TInput extends OpenBoxCopilotActionInput, TArtifact = unknown>(definition: GovernedCopilotToolDefinition<TInput, TArtifact>): GovernedCopilotTool<TInput, TArtifact>;

declare function createOpenBoxApprovalRoute(config?: OpenBoxCopilotKitConfig): {
    decide(request: OpenBoxApprovalDecisionRequest): Promise<OpenBoxApprovalDecisionResult>;
};

declare function createOpenBoxReadinessCheck(config?: OpenBoxCopilotKitConfig): {
    check(): Promise<{
        ok: boolean;
        mode: {
            enabled: boolean;
            strict: boolean;
            governanceMode: "observe" | "enforce";
            failClosed: boolean;
        };
        core: boolean;
        guardrails: boolean;
        policies: boolean;
        behaviorRules: boolean;
        approvals: boolean;
        capabilities: {
            promptGovernance: boolean;
            toolInputGovernance: boolean;
            toolOutputGovernance: boolean;
            finalOutputGovernance: boolean;
            approvals: boolean;
            guardrails: boolean;
            policies: boolean;
            behaviorRules: boolean;
        };
        errors: string[];
        warnings: string[];
    }>;
};

declare function parseToolResult(value: unknown): Record<string, unknown>;

declare function createOpenBoxCopilotRuntime(config: OpenBoxCopilotRuntimeConfig): OpenBoxCopilotRuntime;
declare function createOpenBoxGovernedRunner(runner: OpenBoxCopilotAgentRunnerLike, config?: {
    adapter?: OpenBoxCopilotKitAdapter;
    agents?: string[];
    sessionKey?: (input: OpenBoxCopilotRunInputLike) => string;
}): OpenBoxCopilotAgentRunnerLike;
declare function createOpenBoxRuntimeHooks(config?: {
    adapter?: OpenBoxCopilotKitAdapter;
    agents?: string[];
}): {
    onBeforeHandler(ctx: OpenBoxCopilotRuntimeHookContext): Promise<Request | void>;
    onResponse(ctx: OpenBoxCopilotRuntimeResponseHookContext): Promise<Response | void>;
    onError(ctx: OpenBoxCopilotRuntimeErrorHookContext): Promise<Response | void>;
};

export { type GovernedCopilotTool, type GovernedCopilotToolDefinition, OPENBOX_COPILOTKIT_RESULT_SCHEMA_VERSION, type OpenBoxApprovalDecisionRequest, type OpenBoxApprovalDecisionResult, type OpenBoxCopilotActionInput, type OpenBoxCopilotActionResult, type OpenBoxCopilotAgentRunnerLike, type OpenBoxCopilotGateInput, type OpenBoxCopilotGateKind, type OpenBoxCopilotKitAdapter, type OpenBoxCopilotKitConfig, OpenBoxCopilotKitError, type OpenBoxCopilotLangChainMiddlewareDeps, type OpenBoxCopilotObservableLike, type OpenBoxCopilotPromptRoute, type OpenBoxCopilotResumeInput, type OpenBoxCopilotRunInputLike, type OpenBoxCopilotRunnerRunRequest, type OpenBoxCopilotRuntime, type OpenBoxCopilotRuntimeConfig, type OpenBoxCopilotRuntimeErrorHookContext, type OpenBoxCopilotRuntimeHookContext, type OpenBoxCopilotRuntimeResponseHookContext, type OpenBoxCopilotSessionState, type OpenBoxCopilotTimingEvent, type OpenBoxCopilotTimingKind, type OpenBoxCopilotTimingStep, type OpenBoxCopilotTimings, type OpenBoxCopilotVerdictStatus, type OpenBoxSafePayload, createGovernedCopilotTool, createOpenBoxApprovalRoute, createOpenBoxCopilotKitAdapter, createOpenBoxCopilotRuntime, createOpenBoxGovernedRunner, createOpenBoxReadinessCheck, createOpenBoxRuntimeHooks, parseToolResult };
