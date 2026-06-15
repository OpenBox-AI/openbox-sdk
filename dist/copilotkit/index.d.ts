import { W as WorkflowVerdict, O as OpenBoxCoreClient, i as AgentIdentityConfig } from '../govern-CgRTREi0.js';
import { c as AGEResult, S as SpanData } from '../core-types-Dxgkbox0.js';

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
    ageResult?: AGEResult;
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
