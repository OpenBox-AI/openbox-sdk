import { u as paths, P as PaginatedResponse } from './responses-C2s9PwZF.js';
import { B as BackendClientConfig, A as ApiError } from './env-bindings-CCaolEHB.js';

/**
 * Permission requirements per method, extracted from backend NestJS
 * controllers' @Permissions(PermissionEnum.X) decorators. Methods
 * absent from this map have no @Permissions decorator (public or
 * api-key-gated endpoints). Source: codegen/method-permissions.json.
 */
declare const METHOD_PERMISSIONS: Record<string, readonly string[]>;
/**
 * Thrown by the wrapper's pre-flight check when the caller's cached
 * permission set doesn't cover the method's @Permissions requirements.
 * Saves a round-trip + a 403 from the server.
 */
declare class MissingPermissionError extends Error {
    readonly methodName: string;
    readonly missing: readonly string[];
    readonly have: readonly string[];
    constructor(methodName: string, missing: readonly string[], have: readonly string[]);
}
type Paths = paths;
type RequestBodyOf<P extends keyof Paths, V extends keyof Paths[P]> = Paths[P][V] extends {
    requestBody?: {
        content: {
            'application/json': infer B;
        };
    };
} ? B : never;
type ResponseOf<P extends keyof Paths, V extends keyof Paths[P]> = Paths[P][V] extends {
    responses: infer R;
} ? R extends {
    200: {
        content: {
            'application/json': infer J;
        };
    };
} ? J : R extends {
    201: {
        content: {
            'application/json': infer J;
        };
    };
} ? J : R extends {
    200: {
        content: {
            'text/plain': infer J;
        };
    };
} ? J : R extends {
    201: {
        content: {
            'text/plain': infer J;
        };
    };
} ? J : R extends {
    200: unknown;
} ? unknown : R extends {
    201: unknown;
} ? unknown : unknown : unknown;
/**
 * AUTO-GENERATED wrapper base class; every HTTP operation declared on
 * the OpenboxBackend TypeSpec namespace becomes a typed method here.
 * Hand-written wrappers (OpenBoxClient / OpenBoxCoreClient) extend this
 * class and own construction + the protected helper methods that the
 * generated bodies call into. Adding/removing/renaming an endpoint in
 * the spec flows through here without a code edit on the impl side.
 */
declare abstract class OpenBoxClientWrapperBase {
    protected abstract httpGet<T>(path: string, query?: any): Promise<T>;
    protected abstract httpPost<T>(path: string, body?: unknown): Promise<T>;
    protected abstract httpPut<T>(path: string, body?: unknown, query?: any): Promise<T>;
    protected abstract httpPatch<T>(path: string, body?: unknown): Promise<T>;
    protected abstract httpDelete<T>(path: string, body?: unknown): Promise<T>;
    /**
     * Cached permission set. When undefined, pre-flight checks are
     * skipped; the SDK behaves as before, deferring to the server's
     * 403 response. The hand-written wrapper populates this from
     * `BackendClientConfig.permissions` if the caller provides it.
     */
    protected permissions?: ReadonlySet<string>;
    /**
     * Pre-flight permission check. Called by the hand-written
     * `request()` impl on every outbound HTTP; covers both generated
     * method bodies AND any hand-written shadow that calls http* directly.
     * No-op when `permissions` is undefined or no rule matches the path.
     */
    protected checkPathPermissions(verb: string, path: string): void;
    health(): Promise<ResponseOf<"/health", "get">>;
    getProfile(): Promise<ResponseOf<"/auth/profile", "get">>;
    getCsrfToken(): Promise<ResponseOf<"/auth/csrf", "get">>;
    login(body: RequestBodyOf<"/auth/login", "post">): Promise<ResponseOf<"/auth/login", "post">>;
    logout(body: RequestBodyOf<"/auth/logout", "post">): Promise<ResponseOf<"/auth/logout", "post">>;
    forgotPassword(body: RequestBodyOf<"/auth/forgot-password", "post">): Promise<ResponseOf<"/auth/forgot-password", "post">>;
    resetPassword(body: RequestBodyOf<"/auth/reset-password", "post">): Promise<ResponseOf<"/auth/reset-password", "post">>;
    changePassword(body: RequestBodyOf<"/auth/change-password", "post">): Promise<ResponseOf<"/auth/change-password", "post">>;
    refreshTokens(body: RequestBodyOf<"/auth/refresh", "post">): Promise<ResponseOf<"/auth/refresh", "post">>;
    getUserRoles(): Promise<ResponseOf<"/user/roles", "get">>;
    getAllViolations(): Promise<ResponseOf<"/agent/violations", "get">>;
    getAgentMetrics(): Promise<ResponseOf<"/agent/metrics", "get">>;
    listAgents(query?: Record<string, unknown>): Promise<ResponseOf<"/agent/list", "get">>;
    calculateAivss(body: RequestBodyOf<"/agent/aivss", "post">): Promise<ResponseOf<"/agent/aivss", "post">>;
    createAgent(body: RequestBodyOf<"/agent/create", "post">): Promise<ResponseOf<"/agent/create", "post">>;
    deleteAgent(agentId: string): Promise<ResponseOf<"/agent/{agentId}", "delete">>;
    getAgent(agentId: string): Promise<ResponseOf<"/agent/{agentId}", "get">>;
    updateAgent(agentId: string, body: RequestBodyOf<"/agent/{agentId}", "put">): Promise<ResponseOf<"/agent/{agentId}", "put">>;
    getAgentViolations(agentId: string, body: RequestBodyOf<"/agent/{agentId}/violations", "get">): Promise<ResponseOf<"/agent/{agentId}/violations", "get">>;
    markFalsePositive(agentId: string, violationId: string, body: RequestBodyOf<"/agent/{agentId}/violations/{violationId}/false-positive", "patch">): Promise<ResponseOf<"/agent/{agentId}/violations/{violationId}/false-positive", "patch">>;
    getAgentLogs(agentId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/agent/{agentId}/logs", "get">>;
    getDriftLogs(agentId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/agent/{agentId}/logs/drift", "get">>;
    getAssessments(agentId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/agent/{agentId}/assessments", "get">>;
    updateAivssConfig(agentId: string, body: RequestBodyOf<"/agent/{agentId}/aivss", "put">): Promise<ResponseOf<"/agent/{agentId}/aivss", "put">>;
    updateGoalAlignment(agentId: string, body: RequestBodyOf<"/agent/{agentId}/goal-alignment", "put">): Promise<ResponseOf<"/agent/{agentId}/goal-alignment", "put">>;
    recalculateAivss(agentId: string): Promise<ResponseOf<"/agent/{agentId}/aivss/recalculate", "post">>;
    listGuardrails(agentId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/agent/{agentId}/guardrails", "get">>;
    createGuardrail(agentId: string, body: RequestBodyOf<"/agent/{agentId}/guardrails", "post">): Promise<ResponseOf<"/agent/{agentId}/guardrails", "post">>;
    getGuardrailMetrics(agentId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/agent/{agentId}/guardrails/metrics", "get">>;
    getGuardrailViolationLogs(agentId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/agent/{agentId}/guardrails/violation-logs", "get">>;
    deleteGuardrail(agentId: string, guardrailId: string): Promise<ResponseOf<"/agent/{agentId}/guardrails/{guardrailId}", "delete">>;
    getGuardrail(agentId: string, guardrailId: string): Promise<ResponseOf<"/agent/{agentId}/guardrails/{guardrailId}", "get">>;
    updateGuardrail(agentId: string, guardrailId: string, body: RequestBodyOf<"/agent/{agentId}/guardrails/{guardrailId}", "put">): Promise<ResponseOf<"/agent/{agentId}/guardrails/{guardrailId}", "put">>;
    reorderGuardrail(agentId: string, guardrailId: string, body: RequestBodyOf<"/agent/{agentId}/guardrails/{guardrailId}/reorder", "patch">): Promise<ResponseOf<"/agent/{agentId}/guardrails/{guardrailId}/reorder", "patch">>;
    listPolicies(agentId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/agent/{agentId}/policies", "get">>;
    createPolicy(agentId: string, body: RequestBodyOf<"/agent/{agentId}/policies", "post">): Promise<ResponseOf<"/agent/{agentId}/policies", "post">>;
    getPolicyMetrics(agentId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/agent/{agentId}/policies/metrics", "get">>;
    getCurrentPolicies(agentId: string): Promise<ResponseOf<"/agent/{agentId}/policies/current", "get">>;
    getPolicy(agentId: string, policyId: string): Promise<ResponseOf<"/agent/{agentId}/policies/{policyId}", "get">>;
    updatePolicy(agentId: string, policyId: string, body: RequestBodyOf<"/agent/{agentId}/policies/{policyId}", "put">): Promise<ResponseOf<"/agent/{agentId}/policies/{policyId}", "put">>;
    getPolicyEvaluations(agentId: string, policyId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/agent/{agentId}/policies/{policyId}/evaluations", "get">>;
    listSessions(agentId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/agent/{agentId}/sessions", "get">>;
    getActiveSessions(agentId: string): Promise<ResponseOf<"/agent/{agentId}/active-sessions", "get">>;
    getSession(agentId: string, sessionId: string): Promise<ResponseOf<"/agent/{agentId}/sessions/{sessionId}", "get">>;
    getSessionLogs(agentId: string, sessionId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/agent/{agentId}/sessions/{sessionId}/logs", "get">>;
    getSessionGoalAlignmentStats(agentId: string, sessionId: string): Promise<ResponseOf<"/agent/{agentId}/sessions/{sessionId}/goal-alignment-stats", "get">>;
    getSessionReasoningTrace(agentId: string, sessionId: string): Promise<ResponseOf<"/agent/{agentId}/sessions/{sessionId}/reasoning-trace", "get">>;
    terminateSession(agentId: string, sessionId: string): Promise<ResponseOf<"/agent/{agentId}/sessions/{sessionId}/terminate", "patch">>;
    getGoalAlignmentTrend(agentId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/agent/{agentId}/goal-alignment/trend", "get">>;
    getGoalAlignmentRecentDrifts(agentId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/agent/{agentId}/goal-alignment/recent-drifts", "get">>;
    rotateApiKey(agentId: string): Promise<ResponseOf<"/agent/{agentId}/rotate-api-key", "post">>;
    revokeApiKey(agentId: string): Promise<ResponseOf<"/agent/{agentId}/revoke-api-key", "post">>;
    getObservability(agentId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/agent/{agentId}/observability", "get">>;
    getIssues(agentId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/agent/{agentId}/issues", "get">>;
    getSemanticTypes(): Promise<ResponseOf<"/agent/behavior-rule/semantic-types", "get">>;
    listBehaviorRules(agentId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/agent/{agentId}/behavior-rule", "get">>;
    createBehaviorRule(agentId: string, body: RequestBodyOf<"/agent/{agentId}/behavior-rule", "post">): Promise<ResponseOf<"/agent/{agentId}/behavior-rule", "post">>;
    getCurrentBehaviorRules(agentId: string): Promise<ResponseOf<"/agent/{agentId}/behavior-rule/current", "get">>;
    deleteBehaviorRule(agentId: string, behaviorRuleId: string): Promise<ResponseOf<"/agent/{agentId}/behavior-rule/{behaviorRuleId}", "delete">>;
    getBehaviorRule(agentId: string, behaviorRuleId: string): Promise<ResponseOf<"/agent/{agentId}/behavior-rule/{behaviorRuleId}", "get">>;
    restoreBehaviorRule(agentId: string, behaviorRuleId: string): Promise<ResponseOf<"/agent/{agentId}/behavior-rule/{behaviorRuleId}", "post">>;
    updateBehaviorRule(agentId: string, behaviorRuleId: string, body: RequestBodyOf<"/agent/{agentId}/behavior-rule/{behaviorRuleId}", "put">): Promise<ResponseOf<"/agent/{agentId}/behavior-rule/{behaviorRuleId}", "put">>;
    toggleBehaviorRuleStatus(agentId: string, behaviorRuleId: string, body: RequestBodyOf<"/agent/{agentId}/behavior-rule/{behaviorRuleId}/status", "put">): Promise<ResponseOf<"/agent/{agentId}/behavior-rule/{behaviorRuleId}/status", "put">>;
    getBehaviorRuleVersions(agentId: string, behaviorGroupdId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/agent/{agentId}/behavior-rule/{behaviorGroupdId}/versions", "get">>;
    getBehaviorMetrics(agentId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/agent/{agentId}/behavior/metrics", "get">>;
    getTrustHistories(agentId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/agent/{agentId}/trust/histories", "get">>;
    getTrustEvents(agentId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/agent/{agentId}/trust/events", "get">>;
    getTrustRecoveryStatus(agentId: string): Promise<ResponseOf<"/agent/{agentId}/trust/recovery-status", "get">>;
    getApprovalMetrics(agentId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/agent/{agentId}/approvals/metrics", "get">>;
    getPendingApprovals(agentId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/agent/{agentId}/approvals/pending", "get">>;
    getApprovalHistory(agentId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/agent/{agentId}/approvals/history", "get">>;
    decideApproval(agentId: string, eventId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/agent/{agentId}/approvals/{eventId}/decide", "put">>;
    getInsightsMetrics(agentId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/agent/{agentId}/insights/metrics", "get">>;
    getBehaviorViolations(agentId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/agent/{agentId}/behavior/violations", "get">>;
    getTrustTierChanges(agentId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/agent/{agentId}/trust-tier-changes", "get">>;
    runGuardrailTest(body: RequestBodyOf<"/guardrails/run-test", "post">): Promise<ResponseOf<"/guardrails/run-test", "post">>;
    evaluateRego(body: RequestBodyOf<"/policy/evaluate", "post">): Promise<ResponseOf<"/policy/evaluate", "post">>;
    listWebhooks(query?: Record<string, unknown>): Promise<ResponseOf<"/webhook", "get">>;
    createWebhook(body: RequestBodyOf<"/webhook", "post">): Promise<ResponseOf<"/webhook", "post">>;
    deleteWebhook(id: string): Promise<ResponseOf<"/webhook/{id}", "delete">>;
    getWebhook(id: string): Promise<ResponseOf<"/webhook/{id}", "get">>;
    updateWebhook(id: string, body: RequestBodyOf<"/webhook/{id}", "patch">): Promise<ResponseOf<"/webhook/{id}", "patch">>;
    getWebhookDeliveries(id: string, query?: Record<string, unknown>): Promise<ResponseOf<"/webhook/{id}/deliveries", "get">>;
    testWebhook(id: string): Promise<ResponseOf<"/webhook/{id}/test", "post">>;
    regenerateWebhookSecret(id: string): Promise<ResponseOf<"/webhook/{id}/regenerate-secret", "post">>;
    registerOrganization(body: RequestBodyOf<"/organization/register", "post">): Promise<ResponseOf<"/organization/register", "post">>;
    getDemoSetupStatus(): Promise<ResponseOf<"/organization/demo-setup-status", "get">>;
    getOrgSettings(organizationId: string): Promise<ResponseOf<"/organization/{organizationId}/settings", "get">>;
    updateOrgSettings(organizationId: string, body: RequestBodyOf<"/organization/{organizationId}/settings", "put">): Promise<ResponseOf<"/organization/{organizationId}/settings", "put">>;
    getOrgFeatures(organizationId: string): Promise<ResponseOf<"/organization/{organizationId}/features", "get">>;
    removeMembers(organizationId: string, body: RequestBodyOf<"/organization/{organizationId}/members", "delete">): Promise<ResponseOf<"/organization/{organizationId}/members", "delete">>;
    listMembers(organizationId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/organization/{organizationId}/members", "get">>;
    createUser(organizationId: string, body: RequestBodyOf<"/organization/{organizationId}/users", "post">): Promise<ResponseOf<"/organization/{organizationId}/users", "post">>;
    sendWelcomeEmail(organizationId: string, body: RequestBodyOf<"/organization/{organizationId}/send-welcome-email", "post">): Promise<ResponseOf<"/organization/{organizationId}/send-welcome-email", "post">>;
    inviteUser(organizationId: string, body: RequestBodyOf<"/organization/{organizationId}/invitations", "post">): Promise<ResponseOf<"/organization/{organizationId}/invitations", "post">>;
    removeRoles(organizationId: string, userId: string, body: RequestBodyOf<"/organization/{organizationId}/members/{userId}/roles", "delete">): Promise<ResponseOf<"/organization/{organizationId}/members/{userId}/roles", "delete">>;
    assignRoles(organizationId: string, userId: string, body: RequestBodyOf<"/organization/{organizationId}/members/{userId}/roles", "post">): Promise<ResponseOf<"/organization/{organizationId}/members/{userId}/roles", "post">>;
    updateMember(organizationId: string, userId: string, body: RequestBodyOf<"/organization/{organizationId}/members/{userId}", "put">): Promise<ResponseOf<"/organization/{organizationId}/members/{userId}", "put">>;
    deleteTeams(organizationId: string, body: RequestBodyOf<"/organization/{organizationId}/teams", "delete">): Promise<ResponseOf<"/organization/{organizationId}/teams", "delete">>;
    listTeams(organizationId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/organization/{organizationId}/teams", "get">>;
    createTeam(organizationId: string, body: RequestBodyOf<"/organization/{organizationId}/teams", "post">): Promise<ResponseOf<"/organization/{organizationId}/teams", "post">>;
    getTeamStats(organizationId: string): Promise<ResponseOf<"/organization/{organizationId}/teams/stats", "get">>;
    getTeam(organizationId: string, teamId: string): Promise<ResponseOf<"/organization/{organizationId}/teams/{teamId}", "get">>;
    updateTeam(organizationId: string, teamId: string, body: RequestBodyOf<"/organization/{organizationId}/teams/{teamId}", "put">): Promise<ResponseOf<"/organization/{organizationId}/teams/{teamId}", "put">>;
    removeTeamMembers(organizationId: string, teamId: string, body: RequestBodyOf<"/organization/{organizationId}/teams/{teamId}/members", "delete">): Promise<ResponseOf<"/organization/{organizationId}/teams/{teamId}/members", "delete">>;
    getTeamMembers(organizationId: string, teamId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/organization/{organizationId}/teams/{teamId}/members", "get">>;
    addTeamMembers(organizationId: string, teamId: string, body: RequestBodyOf<"/organization/{organizationId}/teams/{teamId}/members", "post">): Promise<ResponseOf<"/organization/{organizationId}/teams/{teamId}/members", "post">>;
    getAuditLogs(query?: Record<string, unknown>): Promise<ResponseOf<"/organization/audit-logs", "get">>;
    previewAuditExport(body: RequestBodyOf<"/organization/audit-logs/export/preview", "post">): Promise<ResponseOf<"/organization/audit-logs/export/preview", "post">>;
    exportAuditLogs(body: RequestBodyOf<"/organization/audit-logs/export", "post">): Promise<ResponseOf<"/organization/audit-logs/export", "post">>;
    getExportHistory(query?: Record<string, unknown>): Promise<ResponseOf<"/organization/audit-logs/exports", "get">>;
    deleteExport(exportId: string): Promise<ResponseOf<"/organization/audit-logs/export/{exportId}", "delete">>;
    getExport(exportId: string): Promise<ResponseOf<"/organization/audit-logs/export/{exportId}", "get">>;
    downloadExport(exportId: string): Promise<ResponseOf<"/organization/audit-logs/export/{exportId}/download", "get">>;
    getAuditLog(logId: string): Promise<ResponseOf<"/organization/audit-logs/{logId}", "get">>;
    getDashboard(organizationId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/organization/{organizationId}/dashboard", "get">>;
    getOrgApprovalMetrics(organizationId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/organization/{organizationId}/approvals/metrics", "get">>;
    getOrgApprovalSla(organizationId: string): Promise<ResponseOf<"/organization/{organizationId}/approvals/sla", "get">>;
    getOrgApprovals(organizationId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/organization/{organizationId}/approvals", "get">>;
    getOrgApprovalHistory(organizationId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/organization/{organizationId}/approvals/history", "get">>;
    getDashboardTierTrends(organizationId: string): Promise<ResponseOf<"/organization/{organizationId}/dashboard/tier-trends", "get">>;
    getGovernanceFeed(organizationId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/organization/{organizationId}/dashboard/governance-feed", "get">>;
    getTrustDriftLanes(organizationId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/organization/{organizationId}/dashboard/trust-drift-lanes", "get">>;
    getGovernanceSlo(organizationId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/organization/{organizationId}/dashboard/governance-slo", "get">>;
    getViolationHeatcal(organizationId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/organization/{organizationId}/dashboard/violation-heatcal", "get">>;
    getOrgSessions(organizationId: string, query?: Record<string, unknown>): Promise<ResponseOf<"/organization/{organizationId}/sessions", "get">>;
    getOrganization(organizationId: string): Promise<ResponseOf<"/organization/{organizationId}", "get">>;
    listApiKeys(query?: Record<string, unknown>): Promise<ResponseOf<"/api-key", "get">>;
    createApiKey(body: RequestBodyOf<"/api-key", "post">): Promise<ResponseOf<"/api-key", "post">>;
    deleteApiKey(id: string): Promise<ResponseOf<"/api-key/{id}", "delete">>;
    getApiKey(id: string): Promise<ResponseOf<"/api-key/{id}", "get">>;
    updateApiKey(id: string, body: RequestBodyOf<"/api-key/{id}", "patch">): Promise<ResponseOf<"/api-key/{id}", "patch">>;
    deleteSsoConfig(): Promise<ResponseOf<"/sso", "delete">>;
    getSsoConfig(): Promise<ResponseOf<"/sso", "get">>;
    configureSsoSaml(body: RequestBodyOf<"/sso/saml", "post">): Promise<ResponseOf<"/sso/saml", "post">>;
    configureSsoOidc(body: RequestBodyOf<"/sso/oidc", "post">): Promise<ResponseOf<"/sso/oidc", "post">>;
    enforceSso(body: RequestBodyOf<"/sso/enforce", "put">): Promise<ResponseOf<"/sso/enforce", "put">>;
    getSsoMetadata(): Promise<ResponseOf<"/sso/metadata", "get">>;
    verifySsoConfig(): Promise<ResponseOf<"/sso/verify", "post">>;
    getSsoStatus(query?: Record<string, unknown>): Promise<ResponseOf<"/sso/status", "get">>;
}

/**
 * Backend HTTP client configuration. Mirrors `BackendClientConfig` in
 * `specs/typespec/env/main.tsp`; the `onTokenRefresh` callback is a
 * TS-only extension (other languages handle rotation differently and
 * don't need the user-side hook).
 */
interface ClientConfig extends BackendClientConfig {
    /**
     * Callback invoked when tokens are refreshed so the caller can
     * persist them. `refreshToken` may be undefined when Keycloak
     * rotation is disabled; in that case the stored refresh token
     * should stay as-is, not be overwritten.
     */
    onTokenRefresh?: (tokens: {
        accessToken: string;
        refreshToken: string | undefined;
    }) => void;
}

declare class OpenBoxApiError extends Error implements ApiError {
    readonly status: number;
    readonly body: unknown;
    constructor(message: string, status: number, body: unknown);
}

declare class OpenBoxClient extends OpenBoxClientWrapperBase {
    private baseUrl;
    private config;
    protected readonly clientName: string;
    private refreshPromise;
    private rateLimiter;
    private static readonly REFRESH_ENABLED;
    /**
     * Fetch a service's `/version` payload. Public endpoint; no auth, no
     * client construction. Works for any OpenBox HTTP service that exposes
     * `/version` (backend, core, future services). Backend wraps as
     * { status, data: {...} }; core returns flat; both shapes are normalized.
     *
     * Returns null on any error (timeout, network, non-OK, malformed body).
     * Callers fall through to whatever fallback they have.
     */
    static getVersion(baseUrl: string, options?: {
        timeoutMs?: number;
    }): Promise<{
        commit?: string;
        version?: string;
        builtAt?: string;
    } | null>;
    constructor(config: ClientConfig);
    /**
     * Dynamic operation request used by compact API-first tooling.
     * Generated wrapper methods remain the preferred typed surface; this
     * method exists for operationId-driven callers that already resolved
     * a generated endpoint manifest entry.
     */
    requestOperation(method: string, path: string, options?: {
        params?: Record<string, unknown>;
        data?: unknown;
    }): Promise<unknown>;
    /**
     * Update the cached permission set. Call this after a token refresh
     * that returned new claims, or after `getProfile()` if the consumer
     * didn't pre-load permissions at construction time. Pass `undefined`
     * to disable the pre-flight check entirely.
     */
    setPermissions(permissions: string[] | undefined): void;
    /**
    // =========================================================================
    // Agent CRUD
    // =========================================================================
  
    // listAgents / registerOrganization come from the generated base.
  
  
    // Every backend operation comes from the spec-emitted
    // OpenBoxClientWrapperBase. The hand-written wrappers below are gone
    // per the no-legacy-support rule; callers reach for the generated
    // method directly. Where the spec under-declares a response (the
    // generated method returns `unknown`), the call site casts through
    // the wire-shape it depends on so the drift is visible at the use,
    // not hidden in a hand-typed return.
  
  
  
    // ---- removed: every method here was a hand-written wrapper around
    // the generated typed method on OpenBoxClientWrapperBase. After the
    // ResponseOf<> emitter fix the generated methods carry the real
    // response types; the legacy wrappers are gone.
    // =========================================================================
    // User
    // =========================================================================
  
  
    // =========================================================================
    // Pagination helpers
    // =========================================================================
  
    /**
     * Async generator that yields pages from a paginated endpoint.
     * The `fetcher` receives `{ page, perPage }` and must return a `PaginatedResponse<T>`.
     *
     * @example
     * for await (const page of client.paginate((q) => client.listAgents(q))) {
     *   console.log(page); // Agent[]
     * }
     */
    paginate<T>(fetcher: (query: {
        page: number;
        perPage: number;
    }) => Promise<PaginatedResponse<T>>, perPage?: number): AsyncGenerator<T[], void, undefined>;
    /**
     * Fetches all items from a paginated endpoint by auto-paginating.
     *
     * @example
     * const allAgents = await client.paginateAll((q) => client.listAgents(q));
     */
    paginateAll<T>(fetcher: (query: {
        page: number;
        perPage: number;
    }) => Promise<PaginatedResponse<T>>, perPage?: number): Promise<T[]>;
    /**
     * Ensures the access token is still valid. If it is expired (or will be
     * within 60 s) and a refresh token is available, performs an automatic
     * token refresh. Multiple concurrent callers share the same refresh promise
     * to avoid redundant refresh requests.
     */
    private ensureValidToken;
    private performTokenRefresh;
    private static readonly RETRYABLE_STATUSES;
    private executeWithRetry;
    private getRetryDelay;
    private calculateBackoff;
    private sleep;
    /**
     * Generic request method using native fetch with retry and rate limiting.
     */
    private request;
    protected httpGet<T>(path: string, params?: any): Promise<T>;
    protected httpPost<T>(path: string, data?: unknown): Promise<T>;
    protected httpPut<T>(path: string, data?: unknown, params?: any): Promise<T>;
    protected httpPatch<T>(path: string, data?: unknown): Promise<T>;
    protected httpDelete<T>(path: string, data?: unknown): Promise<T>;
    /**
     * Unwraps the standard `{ status, data }` response envelope used by the
     * OpenBox API. If the response does not match the envelope shape, it is
     * returned as-is.
     */
    private unwrap;
}

export { type ClientConfig as C, METHOD_PERMISSIONS as M, OpenBoxApiError as O, MissingPermissionError as a, OpenBoxClient as b };
