import { isTokenExpired } from '@openbox/types';
import { resolveClientName } from '@openbox/env';
import type { TokenPair } from '@openbox/env';
import { TokenBucket } from './rate-limiter.js';
import type {
  PaginationQuery,
  MetricsQuery,
  ApprovalListQuery,
  SessionListQuery,
  AuditLogQuery,
  ExportHistoryQuery,
  AivssConfig,
  GoalAlignmentConfig,
  CreateAgentDto,
  UpdateAgentDto,
  CreateGuardrailDto,
  UpdateGuardrailDto,
  CreatePolicyDto,
  UpdatePolicyDto,
  CreateBehaviorRuleDto,
  UpdateBehaviorRuleDto,
  TestGuardrailDto,
  EvaluateRegoDto,
  UpdateOrgSettingsDto,
  CreateUserDto,
  UpdateMemberDto,
  InviteUserDto,
  UpdateTeamDto,
  CreateTeamDto,
  DeleteTeamsDto,
  AddTeamMembersDto,
  DeleteTeamMembersDto,
  ExportAuditLogsDto,
  PreviewExportDto,
  GetAgentViolationsQuery,
  ChangePasswordDto,
  LoginDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  CreateOrganizationDto,
  SendWelcomeEmailDto,
  CreateApiKeyDto,
  UpdateApiKeyDto,
  CreateWebhookDto,
  UpdateWebhookDto,
  ConfigureOidcDto,
  ConfigureSamlDto,
  EnforceSsoDto,
  PaginatedResponse,
  MessageResponse,
  UserProfile,
  UserRole,
  Agent,
  CreateAgentResponse,
  ApiKeyResponse,
  Guardrail,
  Policy,
  BehaviorRule,
  Session,
  TrustHistory,
  TrustEvent,
  TrustTierChange,
  Assessment,
  Approval,
  OrgApprovalsResponse,
  Violation,
  Organization,
  OrgSettings,
  Team,
  Member,
  AuditLog,
  AuditExport,
  ApiKey,
  Webhook,
  WebhookDelivery,
  SsoStatus,
  OrgFeatures,
  CsrfToken,
} from '@openbox/types';

// ---------------------------------------------------------------------------
// Configuration
//
// Spec source: specs/typespec/env/main.tsp (BackendClientConfig,
// RetryConfig, RateLimitConfig, ApiError). Re-exported here under the
// legacy public names so existing consumers keep compiling. The
// `onTokenRefresh` callback below is the only TS-language-specific
// extension - it has no runtime equivalent in Rust/Python/Go (those
// languages use a poll-and-rewrite pattern instead) and stays
// hand-written.
// ---------------------------------------------------------------------------

import type {
  BackendClientConfig as SpecBackendClientConfig,
  RetryConfig,
  RateLimitConfig,
} from '@openbox/env';

export type EnvName = 'production' | 'staging' | 'local';

/**
 * Backend HTTP client configuration. Mirrors `BackendClientConfig` in
 * `specs/typespec/env/main.tsp`; the `onTokenRefresh` callback is a
 * TS-only extension (other languages handle rotation differently and
 * don't need the user-side hook).
 */
export interface ClientConfig extends SpecBackendClientConfig {
  /**
   * Callback invoked when tokens are refreshed so the caller can
   * persist them. `refreshToken` may be undefined when Keycloak
   * rotation is disabled - in that case the stored refresh token
   * should stay as-is, not be overwritten.
   */
  onTokenRefresh?: (tokens: { accessToken: string; refreshToken: string | undefined }) => void;
}

// ---------------------------------------------------------------------------
// Error wrapper - concrete class implementing the spec's `ApiError`
// model. The class form is TS-specific (Error inheritance); the
// fields (`message`, `status`, `body`) come from the spec.
// ---------------------------------------------------------------------------

import type { ApiError } from '@openbox/env';

export class OpenBoxApiError extends Error implements ApiError {
  public readonly status: number;
  public readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'OpenBoxApiError';
    this.status = status;
    this.body = body;
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

import { OpenBoxClientWrapperBase } from './generated/wrapper-methods.js';

export class OpenBoxClient extends OpenBoxClientWrapperBase {
  private baseUrl: string;
  private config: ClientConfig;
  protected readonly env: EnvName;
  protected readonly clientName: string;
  private refreshPromise: Promise<void> | null = null;
  private rateLimiter: TokenBucket | null = null;

  // Auto-refresh is currently DISABLED because the upstream /auth/refresh
  // endpoint is broken end-to-end (openbox-backend passes user.sub as the
  // Keycloak realm instead of user.orgId; openbox-fe sends snake_case
  // {refresh_token} but the DTO is camelCase {refreshToken}). Flip to true
  // once both fixes ship. The capture path in the CLI continues to save
  // refresh tokens so no re-login is needed after re-enabling.
  private static readonly REFRESH_ENABLED = false;

  /**
   * Fetch a service's `/version` payload. Public endpoint - no auth, no
   * client construction. Works for any OpenBox HTTP service that exposes
   * `/version` (backend, core, future services). Backend wraps as
   * { status, data: {...} }; core returns flat - both shapes are normalized.
   *
   * Returns null on any error (timeout, network, non-OK, malformed body).
   * Callers fall through to whatever fallback they have.
   */
  static async getVersion(
    baseUrl: string,
    options?: { timeoutMs?: number },
  ): Promise<{ commit?: string; version?: string; builtAt?: string } | null> {
    if (!baseUrl) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? 5_000);
    try {
      const res = await fetch(`${baseUrl}/version`, {
        method: 'GET',
        credentials: 'omit',
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const raw = (await res.json()) as Record<string, unknown>;
      const payload =
        raw.data && typeof raw.data === 'object'
          ? (raw.data as Record<string, unknown>)
          : raw;
      const commit = typeof payload.commit === 'string' ? payload.commit : undefined;
      const version = typeof payload.version === 'string' ? payload.version : undefined;
      // Backend serializes as `builtAt`; core (Go/Echo) as `built_at`.
      // Accept both so the same SDK call works against either service.
      const builtAt =
        typeof payload.builtAt === 'string'
          ? payload.builtAt
          : typeof payload.built_at === 'string'
            ? payload.built_at
            : undefined;
      if (!commit && !version && !builtAt) return null;
      return { commit, version, builtAt };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  constructor(config: ClientConfig) {
    super();
    this.config = { ...config };
    this.baseUrl = this.config.apiUrl ?? 'https://api.openbox.ai';
    this.env = this.config.env ?? 'production';
    // Apply OPENBOX_CLIENT_VARIANT (if set) on top of the configured base name.
    // Lets a skill running inside Claude Code / Codex / Cursor identify itself
    // in backend telemetry without each app having to plumb the variant.
    this.clientName = resolveClientName(this.config.clientName ?? 'openbox-cli');
    // Populate the wrapper-base permissions cache so generated methods can
    // pre-flight against MissingPermissionError before any network call.
    // Caller leaves `permissions` undefined to disable the check.
    if (config.permissions) {
      this.permissions = new Set(config.permissions);
    }
    if (config.rateLimit) {
      this.rateLimiter = new TokenBucket(
        config.rateLimit.requestsPerSecond,
        config.rateLimit.burst,
      );
    }
  }

  /**
   * Update the cached permission set. Call this after a token refresh
   * that returned new claims, or after `getProfile()` if the consumer
   * didn't pre-load permissions at construction time. Pass `undefined`
   * to disable the pre-flight check entirely.
   */
  setPermissions(permissions: string[] | undefined): void {
    this.permissions = permissions ? new Set(permissions) : undefined;
  }

  // =========================================================================
  // Auth
  // =========================================================================


  async refreshTokens(): Promise<TokenPair> {
    return this.httpPost('/auth/refresh', {
      refreshToken: this.config.refreshToken,
    }) as Promise<TokenPair>;
  }

  // Backend `LogoutDto` is an empty body - the bearer token identifies the
  // session. Server-side invalidation plus local token wipe is the proper
  // logout path; dropping tokens locally alone leaves the session live on
  // Keycloak until the JWT expires.
  async logout(): Promise<void> {
    await this.httpPost('/auth/logout', {});
  }


  /**
   * Direct credential login. Bypasses the Keycloak browser redirect - useful
   * for headless flows (CLI scripts, mobile sign-in screens, integration
   * tests) where the caller already owns the username/password capture UI.
   * Returns the same `{ accessToken, refreshToken }` pair the OAuth flow
   * produces; persist them via the SDK's token store before further calls.
   *
   * The browser-redirect path (the one most apps actually use) lives outside
   * the SDK by design - it's a Keycloak URL the host app navigates to and
   * an OAuth code it captures on the way back. Once the code is exchanged,
   * every subsequent backend call comes back through this client.
   */

  /**
   * Trigger a password-reset email. The backend mails a single-use token
   * to the address; the caller's UI prompts the user for that token + the
   * new password and then calls `resetPassword`.
   */

  /**
   * Complete the password-reset flow with the token from the email and the
   * new password. The token is single-use and short-lived; failure means
   * the caller should re-prompt for `forgotPassword`.
   */

  /**
   * Service-health probe. Returns whatever the backend's AppController
   * publishes at `/health` - typically `{ status: 'ok' }` plus version
   * metadata. Use this for liveness checks; for build/version data prefer
   * the static `OpenBoxClient.getVersion(baseUrl)` so you don't need a
   * constructed client.
   */
  async getHealth(): Promise<unknown> {
    return this.httpGet('/health');
  }

  // =========================================================================
  // Organization onboarding
  // =========================================================================

  /**
   * Provision a new organization. Public endpoint - no bearer token
   * required, throttled to 10 requests per hour per IP. Used by the
   * marketing-site signup form and by integration scripts that bootstrap
   * test orgs against staging.
   */
  async registerOrganization(dto: CreateOrganizationDto): Promise<unknown> {
    return this.httpPost('/organization/register', dto);
  }

  /**
   * Re-fire the welcome email for a member. Admin-only path normally
   * triggered server-side when a user is invited; surfaced here so admin
   * tooling can resend without round-tripping through the dashboard.
   */
  async sendWelcomeEmail(orgId: string, dto: SendWelcomeEmailDto): Promise<unknown> {
    return this.httpPost(`/organization/${orgId}/send-welcome-email`, dto);
  }

  // =========================================================================
  // Agent CRUD
  // =========================================================================

  async listAgents(query?: {
    page?: number;
    perPage?: number;
    search?: string;
    status?: number;
    team_id?: string;
    tiers?: string[];
    owner_id?: string;
  }): Promise<PaginatedResponse<Agent>> {
    return this.httpGet('/agent/list', query) as Promise<PaginatedResponse<Agent>>;
  }





  // =========================================================================
  // API Keys
  // =========================================================================



  // =========================================================================
  // Guardrails
  // =========================================================================

  async listGuardrails(
    agentId: string,
    query?: PaginationQuery & { processing_stage?: string },
  ): Promise<PaginatedResponse<Guardrail>> {
    return this.httpGet(`/agent/${agentId}/guardrails`, query) as Promise<PaginatedResponse<Guardrail>>;
  }



  async updateGuardrail(
    agentId: string,
    guardrailId: string,
    dto: UpdateGuardrailDto,
  ): Promise<Guardrail> {
    return this.httpPut(`/agent/${agentId}/guardrails/${guardrailId}`, dto) as Promise<Guardrail>;
  }


  // reorderGuardrail comes from the generated base - its body is `{ order }`.
  // (Was previously a 3-arg wrapper that took `order` flat; consumers should
  // now pass `{ order }` to match the spec.)

  async getGuardrailMetrics(agentId: string, query?: MetricsQuery): Promise<unknown> {
    return this.httpGet(`/agent/${agentId}/guardrails/metrics`, query);
  }

  async getGuardrailViolationLogs(
    agentId: string,
    query?: PaginationQuery & { fromTime?: string; toTime?: string; guardrail_type?: string },
  ): Promise<PaginatedResponse<Violation>> {
    return this.httpGet(`/agent/${agentId}/guardrails/violation-logs`, query) as Promise<
      PaginatedResponse<Violation>
    >;
  }

  async runGuardrailTest(dto: TestGuardrailDto): Promise<unknown> {
    return this.httpPost('/guardrails/run-test', dto);
  }

  // =========================================================================
  // Policies
  // =========================================================================






  async getPolicyEvaluations(
    agentId: string,
    policyId: string,
    query?: PaginationQuery,
  ): Promise<PaginatedResponse<unknown>> {
    return this.httpGet(`/agent/${agentId}/policies/${policyId}/evaluations`, query) as Promise<
      PaginatedResponse<unknown>
    >;
  }

  async getPolicyMetrics(agentId: string, query?: MetricsQuery): Promise<unknown> {
    return this.httpGet(`/agent/${agentId}/policies/metrics`, query);
  }

  async evaluateRego(dto: EvaluateRegoDto): Promise<unknown> {
    return this.httpPost('/policy/evaluate', dto);
  }

  // =========================================================================
  // Behavior Rules
  // =========================================================================

  async getSemanticTypes(): Promise<unknown> {
    return this.httpGet('/agent/behavior-rule/semantic-types');
  }

  async listBehaviorRules(
    agentId: string,
    query?: PaginationQuery & { verdict?: number; is_active?: boolean; trigger?: string },
  ): Promise<PaginatedResponse<BehaviorRule>> {
    return this.httpGet(`/agent/${agentId}/behavior-rule`, query) as Promise<
      PaginatedResponse<BehaviorRule>
    >;
  }




  async updateBehaviorRule(
    agentId: string,
    ruleId: string,
    dto: UpdateBehaviorRuleDto,
  ): Promise<BehaviorRule> {
    return this.httpPut(`/agent/${agentId}/behavior-rule/${ruleId}`, dto) as Promise<BehaviorRule>;
  }



  // toggleBehaviorRuleStatus: spec body is `{ is_active }` - call as
  // `toggleBehaviorRuleStatus(agentId, ruleId, { is_active: true })`.
  // Hand-written 3-arg ergonomic wrapper dropped per no-legacy-support.

  async getBehaviorRuleVersions(
    agentId: string,
    groupId: string,
    query?: PaginationQuery,
  ): Promise<PaginatedResponse<BehaviorRule>> {
    return this.httpGet(`/agent/${agentId}/behavior-rule/${groupId}/versions`, query) as Promise<
      PaginatedResponse<BehaviorRule>
    >;
  }

  async getBehaviorMetrics(agentId: string, query?: MetricsQuery): Promise<unknown> {
    return this.httpGet(`/agent/${agentId}/behavior/metrics`, query);
  }

  async getBehaviorViolations(
    agentId: string,
    query?: PaginationQuery,
  ): Promise<PaginatedResponse<Violation>> {
    return this.httpGet(`/agent/${agentId}/behavior/violations`, query) as Promise<
      PaginatedResponse<Violation>
    >;
  }

  // =========================================================================
  // Sessions
  // =========================================================================

  async listSessions(
    agentId: string,
    query?: SessionListQuery,
  ): Promise<PaginatedResponse<Session>> {
    return this.httpGet(`/agent/${agentId}/sessions`, query) as Promise<PaginatedResponse<Session>>;
  }



  async getSessionLogs(
    agentId: string,
    sessionId: string,
    query?: PaginationQuery & { event_type?: string },
  ): Promise<PaginatedResponse<unknown>> {
    return this.httpGet(`/agent/${agentId}/sessions/${sessionId}/logs`, query) as Promise<
      PaginatedResponse<unknown>
    >;
  }

  async getSessionGoalAlignmentStats(agentId: string, sessionId: string): Promise<unknown> {
    return this.httpGet(`/agent/${agentId}/sessions/${sessionId}/goal-alignment-stats`);
  }

  async getSessionReasoningTrace(agentId: string, sessionId: string): Promise<unknown> {
    return this.httpGet(`/agent/${agentId}/sessions/${sessionId}/reasoning-trace`);
  }

  async terminateSession(agentId: string, sessionId: string): Promise<MessageResponse> {
    return this.httpPatch(
      `/agent/${agentId}/sessions/${sessionId}/terminate`,
    ) as Promise<MessageResponse>;
  }

  // =========================================================================
  // Trust
  // =========================================================================

  // getTrustHistories: spec query is a Record<string, unknown> - call as
  // `getTrustHistories(agentId, { duration: '7d' })`.

  async getTrustEvents(
    agentId: string,
    query?: PaginationQuery & { fromTime?: string; toTime?: string },
  ): Promise<PaginatedResponse<TrustEvent>> {
    return this.httpGet(`/agent/${agentId}/trust/events`, query) as Promise<
      PaginatedResponse<TrustEvent>
    >;
  }

  async getTrustTierChanges(
    agentId: string,
    query?: PaginationQuery & { fromTime?: string; toTime?: string },
  ): Promise<PaginatedResponse<TrustTierChange>> {
    return this.httpGet(`/agent/${agentId}/trust-tier-changes`, query) as Promise<
      PaginatedResponse<TrustTierChange>
    >;
  }

  async getTrustRecoveryStatus(agentId: string): Promise<unknown> {
    return this.httpGet(`/agent/${agentId}/trust/recovery-status`);
  }

  // =========================================================================
  // AIVSS
  // =========================================================================

  async getAssessments(
    agentId: string,
    query?: PaginationQuery & { fromTime?: string; toTime?: string },
  ): Promise<PaginatedResponse<Assessment>> {
    return this.httpGet(`/agent/${agentId}/assessments`, query) as Promise<
      PaginatedResponse<Assessment>
    >;
  }

  async updateAivssConfig(
    agentId: string,
    dto: { aivss_config: AivssConfig; reason: string },
  ): Promise<unknown> {
    return this.httpPut(`/agent/${agentId}/aivss`, dto);
  }

  async recalculateAivss(agentId: string): Promise<unknown> {
    return this.httpPost(`/agent/${agentId}/aivss/recalculate`);
  }

  async calculateAivss(dto: AivssConfig): Promise<unknown> {
    return this.httpPost('/agent/aivss', dto);
  }

  // =========================================================================
  // Goal Alignment
  // =========================================================================

  async updateGoalAlignment(agentId: string, dto: GoalAlignmentConfig): Promise<unknown> {
    return this.httpPut(`/agent/${agentId}/goal-alignment`, dto);
  }

  async getGoalAlignmentTrend(agentId: string, query?: MetricsQuery): Promise<unknown> {
    return this.httpGet(`/agent/${agentId}/goal-alignment/trend`, query);
  }

  // getGoalAlignmentRecentDrifts: spec query is a Record<string, unknown> -
  // call as `getGoalAlignmentRecentDrifts(agentId, { limit: 10 })`.

  // =========================================================================
  // Approvals
  // =========================================================================

  async getApprovalMetrics(agentId: string, query?: MetricsQuery): Promise<unknown> {
    return this.httpGet(`/agent/${agentId}/approvals/metrics`, query);
  }

  async getPendingApprovals(
    agentId: string,
    query?: ApprovalListQuery,
  ): Promise<PaginatedResponse<Approval>> {
    return this.httpGet(`/agent/${agentId}/approvals/pending`, query) as Promise<
      PaginatedResponse<Approval>
    >;
  }

  async getApprovalHistory(
    agentId: string,
    query?: ApprovalListQuery,
  ): Promise<PaginatedResponse<Approval>> {
    return this.httpGet(`/agent/${agentId}/approvals/history`, query) as Promise<
      PaginatedResponse<Approval>
    >;
  }

  // decideApproval comes from the generated base. The spec types its body as
  // a query param object - call as `decideApproval(agentId, eventId, { action: 'approve' })`.

  // =========================================================================
  // Observability
  // =========================================================================

  async getObservability(
    agentId: string,
    query?: { fromTime?: string; toTime?: string },
  ): Promise<unknown> {
    return this.httpGet(`/agent/${agentId}/observability`, query);
  }


  async getInsightsMetrics(agentId: string, query?: MetricsQuery): Promise<unknown> {
    return this.httpGet(`/agent/${agentId}/insights/metrics`, query);
  }

  async getAgentLogs(
    agentId: string,
    query?: PaginationQuery,
  ): Promise<PaginatedResponse<unknown>> {
    return this.httpGet(`/agent/${agentId}/logs`, query) as Promise<PaginatedResponse<unknown>>;
  }

  async getDriftLogs(
    agentId: string,
    query?: PaginationQuery,
  ): Promise<PaginatedResponse<unknown>> {
    return this.httpGet(`/agent/${agentId}/logs/drift`, query) as Promise<PaginatedResponse<unknown>>;
  }

  async getAgentMetrics(): Promise<unknown> {
    return this.httpGet('/agent/metrics');
  }

  // =========================================================================
  // Violations
  // =========================================================================


  async getAgentViolations(
    agentId: string,
    query?: GetAgentViolationsQuery,
  ): Promise<PaginatedResponse<Violation>> {
    // Backend controller uses `@Body()` on a GET route - unusual, and Node's
    // fetch (and the HTTP spec) forbids GET-with-body. We send the filters as
    // query params instead; backend ignores them today, but at least the call
    // reaches the server and returns the full list instead of a client-side
    // "Request with GET/HEAD method cannot have body" TypeError. Filters
    // (pattern / sourceType) are functionally dropped until the backend moves
    // to `@Query()` - document as a known limitation in the CLI command.
    return this.httpGet(`/agent/${agentId}/violations`, query) as Promise<
      PaginatedResponse<Violation>
    >;
  }

  // markFalsePositive: spec body is `{ sourceType }` - call as
  // `markFalsePositive(agentId, violationId, { sourceType: '...' })`.

  // =========================================================================
  // Organization
  // =========================================================================




  async getDashboard(
    orgId: string,
    query?: { fromTime?: string; toTime?: string },
  ): Promise<unknown> {
    return this.httpGet(`/organization/${orgId}/dashboard`, query);
  }

  async getDashboardTierTrends(orgId: string): Promise<unknown> {
    return this.httpGet(`/organization/${orgId}/dashboard/tier-trends`);
  }

  async getOrgSessions(
    orgId: string,
    query?: SessionListQuery,
  ): Promise<PaginatedResponse<Session>> {
    return this.httpGet(`/organization/${orgId}/sessions`, query) as Promise<
      PaginatedResponse<Session>
    >;
  }

  // Backend returns `{ approvals: PaginatedResponse<Approval>, metrics }`
  // here, NOT a flat PaginatedResponse - list + count queries run in
  // parallel server-side and both surface (organization.service.ts:487).
  async getOrgApprovals(
    orgId: string,
    query?: ApprovalListQuery,
  ): Promise<OrgApprovalsResponse> {
    return this.httpGet(`/organization/${orgId}/approvals`, query) as Promise<
      OrgApprovalsResponse
    >;
  }

  async getOrgApprovalMetrics(orgId: string, query?: MetricsQuery): Promise<unknown> {
    return this.httpGet(`/organization/${orgId}/approvals/metrics`, query);
  }

  async getOrgApprovalSla(orgId: string): Promise<unknown> {
    return this.httpGet(`/organization/${orgId}/approvals/sla`);
  }

  async getOrgApprovalHistory(
    orgId: string,
    query?: PaginationQuery,
  ): Promise<PaginatedResponse<Approval>> {
    return this.httpGet(`/organization/${orgId}/approvals/history`, query) as Promise<
      PaginatedResponse<Approval>
    >;
  }

  // =========================================================================
  // Teams
  // =========================================================================


  async getTeamStats(orgId: string): Promise<unknown> {
    return this.httpGet(`/organization/${orgId}/teams/stats`);
  }



  async getTeamMembers(
    orgId: string,
    teamId: string,
    query?: PaginationQuery,
  ): Promise<PaginatedResponse<Member>> {
    return this.httpGet(`/organization/${orgId}/teams/${teamId}/members`, query) as Promise<
      PaginatedResponse<Member>
    >;
  }


  async deleteTeams(orgId: string, dto: DeleteTeamsDto): Promise<unknown> {
    // DELETE with body - backend takes `{ids: string[]}` in the request body.
    return this.request('DELETE', `/organization/${orgId}/teams`, { data: dto });
  }

  async addTeamMembers(
    orgId: string,
    teamId: string,
    dto: AddTeamMembersDto,
  ): Promise<unknown> {
    return this.httpPost(`/organization/${orgId}/teams/${teamId}/members`, dto);
  }

  async removeTeamMembers(
    orgId: string,
    teamId: string,
    dto: DeleteTeamMembersDto,
  ): Promise<unknown> {
    return this.request('DELETE', `/organization/${orgId}/teams/${teamId}/members`, {
      data: dto,
    });
  }

  // =========================================================================
  // Members
  // =========================================================================




  // assignRoles / removeRoles / removeMembers come from the generated base.
  // The spec types each body as `{ roles }` / `{ memberIds }` - call as
  // `assignRoles(orgId, userId, { roles: ['admin'] })` rather than passing
  // the array flat.


  // =========================================================================
  // Audit Logs
  // =========================================================================




  async previewAuditExport(dto: PreviewExportDto): Promise<unknown> {
    return this.httpPost('/organization/audit-logs/export/preview', dto);
  }

  async getExportHistory(query?: ExportHistoryQuery): Promise<PaginatedResponse<AuditExport>> {
    return this.httpGet('/organization/audit-logs/exports', query) as Promise<
      PaginatedResponse<AuditExport>
    >;
  }


  async downloadExport(exportId: string): Promise<unknown> {
    return this.httpGet(`/organization/audit-logs/export/${exportId}/download`);
  }


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
  async *paginate<T>(
    fetcher: (query: { page: number; perPage: number }) => Promise<PaginatedResponse<T>>,
    perPage: number = 50,
  ): AsyncGenerator<T[], void, undefined> {
    let page = 0;
    while (true) {
      const result = await fetcher({ page, perPage });
      const items = result.data ?? [];
      if (items.length === 0) break;
      yield items;
      if (items.length < perPage) break;
      page++;
    }
  }

  /**
   * Fetches all items from a paginated endpoint by auto-paginating.
   *
   * @example
   * const allAgents = await client.paginateAll((q) => client.listAgents(q));
   */
  async paginateAll<T>(
    fetcher: (query: { page: number; perPage: number }) => Promise<PaginatedResponse<T>>,
    perPage: number = 50,
  ): Promise<T[]> {
    const all: T[] = [];
    for await (const page of this.paginate(fetcher, perPage)) {
      all.push(...page);
    }
    return all;
  }

  // =========================================================================
  // Health
  // =========================================================================

  async health(): Promise<unknown> {
    return this.httpGet('/health');
  }

  // =========================================================================
  // API keys - live backend, org-scoped, gated on create/read/update/delete:api_key
  // =========================================================================






  // =========================================================================
  // Webhooks - live backend, gated on create/read/update/delete:webhook
  // =========================================================================






  async getWebhookDeliveries(
    id: string,
    query?: PaginationQuery,
  ): Promise<PaginatedResponse<WebhookDelivery>> {
    return this.httpGet(`/webhook/${id}/deliveries`, query) as Promise<
      PaginatedResponse<WebhookDelivery>
    >;
  }

  async regenerateWebhookSecret(id: string): Promise<{ secret: string } & MessageResponse> {
    return this.httpPost(`/webhook/${id}/regenerate-secret`) as Promise<
      { secret: string } & MessageResponse
    >;
  }


  // =========================================================================
  // SSO - live backend, gated on manage:sso
  // =========================================================================

  async getSsoConfig(): Promise<unknown> {
    return this.httpGet('/sso');
  }



  async getSsoMetadata(): Promise<unknown> {
    return this.httpGet('/sso/metadata');
  }





  // =========================================================================
  // Miscellaneous live-backend endpoints (unwrapped pre-port)
  // =========================================================================


  async getDemoSetupStatus(): Promise<unknown> {
    return this.httpGet('/organization/demo-setup-status');
  }


  // =========================================================================
  // Private helpers
  // =========================================================================

  /**
   * Ensures the access token is still valid. If it is expired (or will be
   * within 60 s) and a refresh token is available, performs an automatic
   * token refresh. Multiple concurrent callers share the same refresh promise
   * to avoid redundant refresh requests.
   */
  private async ensureValidToken(): Promise<void> {
    // When refresh is disabled, skip the pre-emptive expiry gate
    // entirely - the 60s safety buffer in isTokenExpired makes
    // freshly-issued tokens (e.g. just captured from an SSO callback,
    // or short Keycloak lifespans) look "expired" even though the
    // server would accept them. Without a refresh path there's nothing
    // we'd do here anyway; let the request fly and trust the server's
    // 401 if the token is genuinely dead. CLI bypasses this whole
    // method via raw fetch() and works fine - same intent here.
    if (!OpenBoxClient.REFRESH_ENABLED) {
      return;
    }

    if (!isTokenExpired(this.config.accessToken)) {
      return;
    }

    if (!this.config.refreshToken) {
      throw new OpenBoxApiError(
        'Access token is expired and no refresh token was provided',
        401,
        null,
      );
    }

    // Deduplicate concurrent refresh attempts
    if (!this.refreshPromise) {
      this.refreshPromise = this.performTokenRefresh();
    }
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async performTokenRefresh(): Promise<void> {
    try {
      const url = `${this.baseUrl}/auth/refresh`;
      const response = await fetch(url, {
        method: 'POST',
        // See request() above for the credentials: 'omit' rationale -
        // same CSRF-cookie-leak applies to the refresh endpoint.
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/json',
          'X-Openbox-Client': this.clientName,
          Authorization: `Bearer ${this.config.accessToken}`,
        },
        body: JSON.stringify({ refreshToken: this.config.refreshToken }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new OpenBoxApiError(
          `Token refresh failed: ${response.status} ${response.statusText}`,
          response.status,
          body,
        );
      }

      const body = await response.json();
      // Response may be wrapped ({data: {...}}), flat ({...}), or use snake_case
      // depending on whether we hit the NestJS wrapper or Keycloak directly.
      const data = body?.data ?? body ?? {};
      const newAccess: string | undefined = data.accessToken ?? data.access_token;
      const newRefresh: string | undefined = data.refreshToken ?? data.refresh_token;

      if (!newAccess) {
        throw new OpenBoxApiError(
          `Token refresh returned no access token (keys: ${Object.keys(data).join(',')})`,
          500,
          body,
        );
      }

      this.config.accessToken = newAccess;
      if (newRefresh) this.config.refreshToken = newRefresh;

      if (this.config.onTokenRefresh) {
        // Pass the live refresh token (may be undefined if rotation is off and
        // we've never had one). Coercing to '' used to round-trip through
        // saveTokens as undefined and clobber the stored RT.
        this.config.onTokenRefresh({
          accessToken: this.config.accessToken,
          refreshToken: this.config.refreshToken,
        });
      }
    } catch (err) {
      if (err instanceof OpenBoxApiError) throw err;
      const message =
        err instanceof Error ? `Token refresh failed: ${err.message}` : 'Token refresh failed';
      throw new OpenBoxApiError(message, 401, err);
    }
  }

  // -------------------------------------------------------------------------
  // Retry helpers
  // -------------------------------------------------------------------------

  private static readonly RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

  private async executeWithRetry(url: string, fetchOptions: RequestInit): Promise<Response> {
    const maxRetries = this.config.retry?.maxRetries ?? 3;
    const initialDelay = this.config.retry?.initialDelayMs ?? 500;
    const maxDelay = this.config.retry?.maxDelayMs ?? 30_000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, fetchOptions);

        if (response.ok || !OpenBoxClient.RETRYABLE_STATUSES.has(response.status)) {
          return response;
        }

        if (attempt === maxRetries) {
          return response; // let caller throw OpenBoxApiError
        }

        const delay = this.getRetryDelay(response, attempt, initialDelay, maxDelay);
        await this.sleep(delay);
      } catch (err) {
        // Network errors (TypeError from fetch)
        if (attempt === maxRetries || !(err instanceof TypeError)) {
          throw err;
        }
        const delay = this.calculateBackoff(attempt, initialDelay, maxDelay);
        await this.sleep(delay);
      }
    }

    throw new Error('Retry loop exited unexpectedly');
  }

  private getRetryDelay(
    response: Response,
    attempt: number,
    initialDelay: number,
    maxDelay: number,
  ): number {
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      if (retryAfter) {
        const seconds = Number(retryAfter);
        if (!isNaN(seconds)) {
          return Math.min(seconds * 1000, maxDelay);
        }
        const date = Date.parse(retryAfter);
        if (!isNaN(date)) {
          return Math.min(Math.max(date - Date.now(), 0), maxDelay);
        }
      }
    }
    return this.calculateBackoff(attempt, initialDelay, maxDelay);
  }

  private calculateBackoff(attempt: number, initialDelay: number, maxDelay: number): number {
    const exponential = initialDelay * Math.pow(2, attempt);
    const jitter = Math.random() * initialDelay * 0.5;
    return Math.min(exponential + jitter, maxDelay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // -------------------------------------------------------------------------
  // Core request pipeline
  // -------------------------------------------------------------------------

  /**
   * Generic request method using native fetch with retry and rate limiting.
   */
  private async request(
    method: string,
    path: string,
    options?: {
      params?: Record<string, unknown>;
      data?: unknown;
    },
  ): Promise<unknown> {
    // Pre-flight permission check. Throws MissingPermissionError BEFORE
    // we touch the network when the cached perm set doesn't cover this
    // (verb, path) tuple. No-op when permissions are unset (legacy).
    // Sits at the request() layer so generated methods AND any
    // hand-written shadow that calls http* hits the same gate.
    this.checkPathPermissions(method, path);

    await this.ensureValidToken();

    if (this.rateLimiter) {
      await this.rateLimiter.acquire();
    }

    let url = `${this.baseUrl}${path}`;
    if (options?.params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(options.params)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          // Repeat the key per element so the backend parses it as an
          // array (`tiers=2&tiers=3`) instead of a comma-joined scalar
          // string from `String([...])`. Without this, server-side
          // array filters like `tiers[]` and `team_ids[]` silently
          // miss and return unfiltered results.
          for (const v of value) {
            if (v !== undefined && v !== null) searchParams.append(key, String(v));
          }
        } else {
          searchParams.append(key, String(value));
        }
      }
      const qs = searchParams.toString();
      if (qs) url += `?${qs}`;
    }

    const timeoutMs = this.config.timeoutMs ?? 30_000;
    // AbortController + setTimeout instead of AbortSignal.timeout -
    // Hermes (React Native's JS engine) doesn't ship AbortSignal.timeout.
    // The controller pattern is supported across Node, browsers, and RN.
    // executeWithRetry handles request lifecycle so the timer is cleared
    // after the response (or its error) lands.
    const buildOptions = (): { init: RequestInit; cancel: () => void } => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      return {
        init: {
          method,
          // credentials: 'omit' prevents RN/iOS from auto-sending cookies
          // leaked from a WKWebView via sharedCookiesEnabled. The backend's
          // CSRF guard (jwt-auth.guard.ts) fires when an XSRF-TOKEN cookie
          // is present without a matching X-XSRF-TOKEN header - JWT-only
          // clients (CLI, mobile SDK) don't have the header, so they 401.
          // Omitting cookies entirely is the right behavior for a Bearer-auth
          // API client; cookies should never affect SDK requests.
          credentials: 'omit',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.accessToken}`,
            // Required by the backend's auth guard - presence-only check, value is arbitrary.
            // Each consumer sets its own via ClientConfig.clientName.
            'X-Openbox-Client': this.clientName,
          },
          signal: controller.signal,
          body: options?.data !== undefined ? JSON.stringify(options.data) : undefined,
        },
        cancel: () => clearTimeout(timer),
      };
    };

    const first = buildOptions();
    let response: Response;
    try {
      response = await this.executeWithRetry(url, first.init);
    } finally {
      first.cancel();
    }

    // Reactive refresh path: DISABLED. See ensureValidToken() for context.
    // Leaving the code shape here so flipping REFRESH_ENABLED is a single
    // boolean change.
    if (
      OpenBoxClient.REFRESH_ENABLED &&
      response.status === 401 &&
      this.config.refreshToken
    ) {
      try {
        await this.performTokenRefresh();
        const retry = buildOptions();
        try {
          response = await this.executeWithRetry(url, retry.init);
        } finally {
          retry.cancel();
        }
      } catch {
        /* fall through to the original 401 */
      }
    }
    // (No console.error on the 401 branch either - same reason as
    // ensureValidToken's expired-token branch above. The OpenBoxApiError
    // thrown below carries the status; consumers handle the surface.)

    const contentType = response.headers.get('content-type');
    const isJson = contentType?.includes('application/json');

    if (!response.ok) {
      const body = isJson ? await response.json() : await response.text();
      throw new OpenBoxApiError(
        `Request failed: ${response.status} ${response.statusText}`,
        response.status,
        body,
      );
    }

    if (!isJson) {
      const text = await response.text();
      return text as unknown;
    }

    const json = await response.json();
    return this.unwrap(json);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // HTTP helpers exposed to the generated wrapper base class (and to
  // hand-written overrides for endpoints that need bespoke logic). The
  // `http` prefix avoids name clashes with wire methods like
  // `getProfile` / `postEvent` that TypeScript would otherwise read as
  // overloads of an unprefixed `get` / `post`.
  protected async httpGet<T>(
    path: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params?: any,
  ): Promise<T> {
    return this.request('GET', path, { params }) as Promise<T>;
  }

  protected async httpPost<T>(path: string, data?: unknown): Promise<T> {
    return this.request('POST', path, { data }) as Promise<T>;
  }

  protected async httpPut<T>(
    path: string,
    data?: unknown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params?: any,
  ): Promise<T> {
    return this.request('PUT', path, { data, params }) as Promise<T>;
  }

  protected async httpPatch<T>(path: string, data?: unknown): Promise<T> {
    return this.request('PATCH', path, { data }) as Promise<T>;
  }

  protected async httpDelete<T>(path: string, data?: unknown): Promise<T> {
    return this.request('DELETE', path, { data }) as Promise<T>;
  }

  /**
   * Unwraps the standard `{ status, data }` response envelope used by the
   * OpenBox API. If the response does not match the envelope shape, it is
   * returned as-is.
   */
  private unwrap(response: unknown): unknown {
    if (
      response !== null &&
      typeof response === 'object' &&
      'data' in (response as Record<string, unknown>)
    ) {
      return (response as Record<string, unknown>).data;
    }
    return response;
  }
}
