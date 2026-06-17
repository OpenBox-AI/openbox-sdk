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

export { type AgentIdentityConfig as A, type BehavioralResult as B, CoreApiError as C, OpenBoxCoreClient as O, type CoreClientConfig as a, signAgentIdentityRequest as s };
