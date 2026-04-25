import { isTokenExpired } from '@openbox/types';
import { resolveClientName } from '@openbox/env';
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
  TokenPair,
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
// ---------------------------------------------------------------------------

export interface RetryConfig {
  /** Maximum number of retry attempts. Default: 3 */
  maxRetries?: number;
  /** Initial delay in ms before first retry. Default: 500 */
  initialDelayMs?: number;
  /** Maximum delay in ms between retries. Default: 30000 */
  maxDelayMs?: number;
}

export interface RateLimitConfig {
  /** Maximum requests per second */
  requestsPerSecond: number;
  /** Burst capacity (defaults to requestsPerSecond) */
  burst?: number;
}

export type EnvName = 'production' | 'staging' | 'local';

export interface ClientConfig {
  /** Base URL of the OpenBox API. Defaults to https://api.openbox.ai */
  apiUrl?: string;
  /** Bearer access token (JWT) */
  accessToken: string;
  /** Optional refresh token for automatic token renewal */
  refreshToken?: string;
  /** Callback invoked when tokens are refreshed so the caller can persist them.
   * `refreshToken` may be undefined when Keycloak rotation is disabled - in that
   * case the stored refresh token should stay as-is, not be overwritten. */
  onTokenRefresh?: (tokens: { accessToken: string; refreshToken: string | undefined }) => void;
  /** Request timeout in milliseconds. Default: 30000 (30s) */
  timeoutMs?: number;
  /** Retry configuration for failed requests */
  retry?: RetryConfig;
  /** Client-side rate limiting */
  rateLimit?: RateLimitConfig;
  /** Target environment. Branch on this.env when prod/staging diverge. Defaults to 'production'. */
  env?: EnvName;
  /** Value sent in the `X-Openbox-Client` header on every backend request.
   * Backend auth guard is presence-only, so any value passes - this is for
   * telemetry / log filtering. Each consumer (CLI, extension, mobile, MCP, ...)
   * should set its own. Defaults to 'openbox-cli'. */
  clientName?: string;
}

// ---------------------------------------------------------------------------
// Error wrapper
// ---------------------------------------------------------------------------

export class OpenBoxApiError extends Error {
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

export class OpenBoxClient {
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

  constructor(config: ClientConfig) {
    this.config = { ...config };
    this.baseUrl = this.config.apiUrl ?? 'https://api.openbox.ai';
    this.env = this.config.env ?? 'production';
    // Apply OPENBOX_CLIENT_VARIANT (if set) on top of the configured base name.
    // Lets a skill running inside Claude Code / Codex / Cursor identify itself
    // in backend telemetry without each app having to plumb the variant.
    this.clientName = resolveClientName(this.config.clientName ?? 'openbox-cli');
    if (config.rateLimit) {
      this.rateLimiter = new TokenBucket(
        config.rateLimit.requestsPerSecond,
        config.rateLimit.burst,
      );
    }
  }

  // =========================================================================
  // Auth
  // =========================================================================

  async getProfile(): Promise<UserProfile> {
    return this.get('/auth/profile') as Promise<UserProfile>;
  }

  async refreshTokens(): Promise<TokenPair> {
    return this.post('/auth/refresh', {
      refreshToken: this.config.refreshToken,
    }) as Promise<TokenPair>;
  }

  // Backend `LogoutDto` is an empty body - the bearer token identifies the
  // session. Server-side invalidation plus local token wipe is the proper
  // logout path; dropping tokens locally alone leaves the session live on
  // Keycloak until the JWT expires.
  async logout(): Promise<void> {
    await this.post('/auth/logout', {});
  }

  async changePassword(dto: ChangePasswordDto): Promise<MessageResponse> {
    return this.post('/auth/change-password', dto) as Promise<MessageResponse>;
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
  }): Promise<PaginatedResponse<Agent>> {
    return this.get('/agent/list', query) as Promise<PaginatedResponse<Agent>>;
  }

  async createAgent(dto: CreateAgentDto): Promise<CreateAgentResponse> {
    return this.post('/agent/create', dto) as Promise<CreateAgentResponse>;
  }

  async getAgent(agentId: string): Promise<Agent> {
    return this.get(`/agent/${agentId}`) as Promise<Agent>;
  }

  async updateAgent(agentId: string, dto: UpdateAgentDto): Promise<Agent> {
    return this.put(`/agent/${agentId}`, dto) as Promise<Agent>;
  }

  async deleteAgent(agentId: string): Promise<MessageResponse> {
    return this.del(`/agent/${agentId}`) as Promise<MessageResponse>;
  }

  // =========================================================================
  // API Keys
  // =========================================================================

  async rotateApiKey(agentId: string): Promise<ApiKeyResponse> {
    return this.post(`/agent/${agentId}/rotate-api-key`) as Promise<ApiKeyResponse>;
  }

  async revokeApiKey(agentId: string): Promise<MessageResponse> {
    return this.post(`/agent/${agentId}/revoke-api-key`) as Promise<MessageResponse>;
  }

  // =========================================================================
  // Guardrails
  // =========================================================================

  async listGuardrails(
    agentId: string,
    query?: PaginationQuery & { processing_stage?: string },
  ): Promise<PaginatedResponse<Guardrail>> {
    return this.get(`/agent/${agentId}/guardrails`, query) as Promise<PaginatedResponse<Guardrail>>;
  }

  async createGuardrail(agentId: string, dto: CreateGuardrailDto): Promise<Guardrail> {
    return this.post(`/agent/${agentId}/guardrails`, dto) as Promise<Guardrail>;
  }

  async getGuardrail(agentId: string, guardrailId: string): Promise<Guardrail> {
    return this.get(`/agent/${agentId}/guardrails/${guardrailId}`) as Promise<Guardrail>;
  }

  async updateGuardrail(
    agentId: string,
    guardrailId: string,
    dto: UpdateGuardrailDto,
  ): Promise<Guardrail> {
    return this.put(`/agent/${agentId}/guardrails/${guardrailId}`, dto) as Promise<Guardrail>;
  }

  async deleteGuardrail(agentId: string, guardrailId: string): Promise<MessageResponse> {
    return this.del(`/agent/${agentId}/guardrails/${guardrailId}`) as Promise<MessageResponse>;
  }

  async reorderGuardrail(agentId: string, guardrailId: string, order: number): Promise<Guardrail> {
    return this.patch(`/agent/${agentId}/guardrails/${guardrailId}/reorder`, {
      order,
    }) as Promise<Guardrail>;
  }

  async getGuardrailMetrics(agentId: string, query?: MetricsQuery): Promise<unknown> {
    return this.get(`/agent/${agentId}/guardrails/metrics`, query);
  }

  async getGuardrailViolationLogs(
    agentId: string,
    query?: PaginationQuery & { fromTime?: string; toTime?: string; guardrail_type?: string },
  ): Promise<PaginatedResponse<Violation>> {
    return this.get(`/agent/${agentId}/guardrails/violation-logs`, query) as Promise<
      PaginatedResponse<Violation>
    >;
  }

  async runGuardrailTest(dto: TestGuardrailDto): Promise<unknown> {
    return this.post('/guardrails/run-test', dto);
  }

  // =========================================================================
  // Policies
  // =========================================================================

  async listPolicies(agentId: string, query?: PaginationQuery): Promise<PaginatedResponse<Policy>> {
    return this.get(`/agent/${agentId}/policies`, query) as Promise<PaginatedResponse<Policy>>;
  }

  async createPolicy(agentId: string, dto: CreatePolicyDto): Promise<Policy> {
    return this.post(`/agent/${agentId}/policies`, dto) as Promise<Policy>;
  }

  async getCurrentPolicies(agentId: string): Promise<Policy[]> {
    return this.get(`/agent/${agentId}/policies/current`) as Promise<Policy[]>;
  }

  async getPolicy(agentId: string, policyId: string): Promise<Policy> {
    return this.get(`/agent/${agentId}/policies/${policyId}`) as Promise<Policy>;
  }

  async updatePolicy(agentId: string, policyId: string, dto: UpdatePolicyDto): Promise<Policy> {
    return this.put(`/agent/${agentId}/policies/${policyId}`, dto) as Promise<Policy>;
  }

  async getPolicyEvaluations(
    agentId: string,
    policyId: string,
    query?: PaginationQuery,
  ): Promise<PaginatedResponse<unknown>> {
    return this.get(`/agent/${agentId}/policies/${policyId}/evaluations`, query) as Promise<
      PaginatedResponse<unknown>
    >;
  }

  async getPolicyMetrics(agentId: string, query?: MetricsQuery): Promise<unknown> {
    return this.get(`/agent/${agentId}/policies/metrics`, query);
  }

  async evaluateRego(dto: EvaluateRegoDto): Promise<unknown> {
    return this.post('/policy/evaluate', dto);
  }

  // =========================================================================
  // Behavior Rules
  // =========================================================================

  async getSemanticTypes(): Promise<unknown> {
    return this.get('/agent/behavior-rule/semantic-types');
  }

  async listBehaviorRules(
    agentId: string,
    query?: PaginationQuery & { verdict?: number; is_active?: boolean; trigger?: string },
  ): Promise<PaginatedResponse<BehaviorRule>> {
    return this.get(`/agent/${agentId}/behavior-rule`, query) as Promise<
      PaginatedResponse<BehaviorRule>
    >;
  }

  async getCurrentBehaviorRules(agentId: string): Promise<BehaviorRule[]> {
    return this.get(`/agent/${agentId}/behavior-rule/current`) as Promise<BehaviorRule[]>;
  }

  async createBehaviorRule(agentId: string, dto: CreateBehaviorRuleDto): Promise<BehaviorRule> {
    return this.post(`/agent/${agentId}/behavior-rule`, dto) as Promise<BehaviorRule>;
  }

  async getBehaviorRule(agentId: string, ruleId: string): Promise<BehaviorRule> {
    return this.get(`/agent/${agentId}/behavior-rule/${ruleId}`) as Promise<BehaviorRule>;
  }

  async updateBehaviorRule(
    agentId: string,
    ruleId: string,
    dto: UpdateBehaviorRuleDto,
  ): Promise<BehaviorRule> {
    return this.put(`/agent/${agentId}/behavior-rule/${ruleId}`, dto) as Promise<BehaviorRule>;
  }

  async deleteBehaviorRule(agentId: string, ruleId: string): Promise<MessageResponse> {
    return this.del(`/agent/${agentId}/behavior-rule/${ruleId}`) as Promise<MessageResponse>;
  }

  async restoreBehaviorRule(agentId: string, ruleId: string): Promise<BehaviorRule> {
    return this.post(`/agent/${agentId}/behavior-rule/${ruleId}`) as Promise<BehaviorRule>;
  }

  async toggleBehaviorRuleStatus(
    agentId: string,
    ruleId: string,
    isActive: boolean,
  ): Promise<BehaviorRule> {
    return this.put(`/agent/${agentId}/behavior-rule/${ruleId}/status`, {
      is_active: isActive,
    }) as Promise<BehaviorRule>;
  }

  async getBehaviorRuleVersions(
    agentId: string,
    groupId: string,
    query?: PaginationQuery,
  ): Promise<PaginatedResponse<BehaviorRule>> {
    return this.get(`/agent/${agentId}/behavior-rule/${groupId}/versions`, query) as Promise<
      PaginatedResponse<BehaviorRule>
    >;
  }

  async getBehaviorMetrics(agentId: string, query?: MetricsQuery): Promise<unknown> {
    return this.get(`/agent/${agentId}/behavior/metrics`, query);
  }

  async getBehaviorViolations(
    agentId: string,
    query?: PaginationQuery,
  ): Promise<PaginatedResponse<Violation>> {
    return this.get(`/agent/${agentId}/behavior/violations`, query) as Promise<
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
    return this.get(`/agent/${agentId}/sessions`, query) as Promise<PaginatedResponse<Session>>;
  }

  async getActiveSessions(agentId: string): Promise<Session[]> {
    return this.get(`/agent/${agentId}/active-sessions`) as Promise<Session[]>;
  }

  async getSession(agentId: string, sessionId: string): Promise<Session> {
    return this.get(`/agent/${agentId}/sessions/${sessionId}`) as Promise<Session>;
  }

  async getSessionLogs(
    agentId: string,
    sessionId: string,
    query?: PaginationQuery & { event_type?: string },
  ): Promise<PaginatedResponse<unknown>> {
    return this.get(`/agent/${agentId}/sessions/${sessionId}/logs`, query) as Promise<
      PaginatedResponse<unknown>
    >;
  }

  async getSessionGoalAlignmentStats(agentId: string, sessionId: string): Promise<unknown> {
    return this.get(`/agent/${agentId}/sessions/${sessionId}/goal-alignment-stats`);
  }

  async getSessionReasoningTrace(agentId: string, sessionId: string): Promise<unknown> {
    return this.get(`/agent/${agentId}/sessions/${sessionId}/reasoning-trace`);
  }

  async terminateSession(agentId: string, sessionId: string): Promise<MessageResponse> {
    return this.patch(
      `/agent/${agentId}/sessions/${sessionId}/terminate`,
    ) as Promise<MessageResponse>;
  }

  // =========================================================================
  // Trust
  // =========================================================================

  async getTrustHistories(
    agentId: string,
    duration: '7d' | '30d' | '90d' | '1y' = '7d',
  ): Promise<TrustHistory[]> {
    return this.get(`/agent/${agentId}/trust/histories`, { duration }) as Promise<TrustHistory[]>;
  }

  async getTrustEvents(
    agentId: string,
    query?: PaginationQuery & { fromTime?: string; toTime?: string },
  ): Promise<PaginatedResponse<TrustEvent>> {
    return this.get(`/agent/${agentId}/trust/events`, query) as Promise<
      PaginatedResponse<TrustEvent>
    >;
  }

  async getTrustTierChanges(
    agentId: string,
    query?: PaginationQuery & { fromTime?: string; toTime?: string },
  ): Promise<PaginatedResponse<TrustTierChange>> {
    return this.get(`/agent/${agentId}/trust-tier-changes`, query) as Promise<
      PaginatedResponse<TrustTierChange>
    >;
  }

  async getTrustRecoveryStatus(agentId: string): Promise<unknown> {
    return this.get(`/agent/${agentId}/trust/recovery-status`);
  }

  // =========================================================================
  // AIVSS
  // =========================================================================

  async getAssessments(
    agentId: string,
    query?: PaginationQuery & { fromTime?: string; toTime?: string },
  ): Promise<PaginatedResponse<Assessment>> {
    return this.get(`/agent/${agentId}/assessments`, query) as Promise<
      PaginatedResponse<Assessment>
    >;
  }

  async updateAivssConfig(
    agentId: string,
    dto: { aivss_config: AivssConfig; reason: string },
  ): Promise<unknown> {
    return this.put(`/agent/${agentId}/aivss`, dto);
  }

  async recalculateAivss(agentId: string): Promise<unknown> {
    return this.post(`/agent/${agentId}/aivss/recalculate`);
  }

  async calculateAivss(dto: AivssConfig): Promise<unknown> {
    return this.post('/agent/aivss', dto);
  }

  // =========================================================================
  // Goal Alignment
  // =========================================================================

  async updateGoalAlignment(agentId: string, dto: GoalAlignmentConfig): Promise<unknown> {
    return this.put(`/agent/${agentId}/goal-alignment`, dto);
  }

  async getGoalAlignmentTrend(agentId: string, query?: MetricsQuery): Promise<unknown> {
    return this.get(`/agent/${agentId}/goal-alignment/trend`, query);
  }

  async getGoalAlignmentRecentDrifts(agentId: string, limit: number = 10): Promise<unknown> {
    return this.get(`/agent/${agentId}/goal-alignment/recent-drifts`, { limit });
  }

  // =========================================================================
  // Approvals
  // =========================================================================

  async getApprovalMetrics(agentId: string, query?: MetricsQuery): Promise<unknown> {
    return this.get(`/agent/${agentId}/approvals/metrics`, query);
  }

  async getPendingApprovals(
    agentId: string,
    query?: ApprovalListQuery,
  ): Promise<PaginatedResponse<Approval>> {
    return this.get(`/agent/${agentId}/approvals/pending`, query) as Promise<
      PaginatedResponse<Approval>
    >;
  }

  async getApprovalHistory(
    agentId: string,
    query?: ApprovalListQuery,
  ): Promise<PaginatedResponse<Approval>> {
    return this.get(`/agent/${agentId}/approvals/history`, query) as Promise<
      PaginatedResponse<Approval>
    >;
  }

  async decideApproval(
    agentId: string,
    eventId: string,
    action: 'approve' | 'reject',
  ): Promise<Approval> {
    return this.put(`/agent/${agentId}/approvals/${eventId}/decide`, undefined, {
      action,
    }) as Promise<Approval>;
  }

  // =========================================================================
  // Observability
  // =========================================================================

  async getObservability(
    agentId: string,
    query?: { fromTime?: string; toTime?: string },
  ): Promise<unknown> {
    return this.get(`/agent/${agentId}/observability`, query);
  }

  async getIssues(agentId: string, query?: PaginationQuery): Promise<PaginatedResponse<unknown>> {
    return this.get(`/agent/${agentId}/issues`, query) as Promise<PaginatedResponse<unknown>>;
  }

  async getInsightsMetrics(agentId: string, query?: MetricsQuery): Promise<unknown> {
    return this.get(`/agent/${agentId}/insights/metrics`, query);
  }

  async getAgentLogs(
    agentId: string,
    query?: PaginationQuery,
  ): Promise<PaginatedResponse<unknown>> {
    return this.get(`/agent/${agentId}/logs`, query) as Promise<PaginatedResponse<unknown>>;
  }

  async getDriftLogs(
    agentId: string,
    query?: PaginationQuery,
  ): Promise<PaginatedResponse<unknown>> {
    return this.get(`/agent/${agentId}/logs/drift`, query) as Promise<PaginatedResponse<unknown>>;
  }

  async getAgentMetrics(): Promise<unknown> {
    return this.get('/agent/metrics');
  }

  // =========================================================================
  // Violations
  // =========================================================================

  async getAllViolations(): Promise<Violation[]> {
    return this.get('/agent/violations') as Promise<Violation[]>;
  }

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
    return this.get(`/agent/${agentId}/violations`, query) as Promise<
      PaginatedResponse<Violation>
    >;
  }

  async markFalsePositive(
    agentId: string,
    violationId: string,
    sourceType: string,
  ): Promise<Violation> {
    return this.patch(`/agent/${agentId}/violations/${violationId}/false-positive`, {
      sourceType,
    }) as Promise<Violation>;
  }

  // =========================================================================
  // Organization
  // =========================================================================

  async getOrganization(orgId: string): Promise<Organization> {
    return this.get(`/organization/${orgId}`) as Promise<Organization>;
  }

  async getOrgSettings(orgId: string): Promise<OrgSettings> {
    return this.get(`/organization/${orgId}/settings`) as Promise<OrgSettings>;
  }

  async updateOrgSettings(orgId: string, dto: UpdateOrgSettingsDto): Promise<OrgSettings> {
    return this.put(`/organization/${orgId}/settings`, dto) as Promise<OrgSettings>;
  }

  async getDashboard(
    orgId: string,
    query?: { fromTime?: string; toTime?: string },
  ): Promise<unknown> {
    return this.get(`/organization/${orgId}/dashboard`, query);
  }

  async getDashboardTierTrends(orgId: string): Promise<unknown> {
    return this.get(`/organization/${orgId}/dashboard/tier-trends`);
  }

  async getOrgSessions(
    orgId: string,
    query?: SessionListQuery,
  ): Promise<PaginatedResponse<Session>> {
    return this.get(`/organization/${orgId}/sessions`, query) as Promise<
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
    return this.get(`/organization/${orgId}/approvals`, query) as Promise<
      OrgApprovalsResponse
    >;
  }

  async getOrgApprovalMetrics(orgId: string, query?: MetricsQuery): Promise<unknown> {
    return this.get(`/organization/${orgId}/approvals/metrics`, query);
  }

  async getOrgApprovalSla(orgId: string): Promise<unknown> {
    return this.get(`/organization/${orgId}/approvals/sla`);
  }

  async getOrgApprovalHistory(
    orgId: string,
    query?: PaginationQuery,
  ): Promise<PaginatedResponse<Approval>> {
    return this.get(`/organization/${orgId}/approvals/history`, query) as Promise<
      PaginatedResponse<Approval>
    >;
  }

  // =========================================================================
  // Teams
  // =========================================================================

  async listTeams(orgId: string, query?: PaginationQuery): Promise<PaginatedResponse<Team>> {
    return this.get(`/organization/${orgId}/teams`, query) as Promise<PaginatedResponse<Team>>;
  }

  async getTeamStats(orgId: string): Promise<unknown> {
    return this.get(`/organization/${orgId}/teams/stats`);
  }

  async getTeam(orgId: string, teamId: string): Promise<Team> {
    return this.get(`/organization/${orgId}/teams/${teamId}`) as Promise<Team>;
  }

  async updateTeam(orgId: string, teamId: string, dto: UpdateTeamDto): Promise<Team> {
    return this.put(`/organization/${orgId}/teams/${teamId}`, dto) as Promise<Team>;
  }

  async getTeamMembers(
    orgId: string,
    teamId: string,
    query?: PaginationQuery,
  ): Promise<PaginatedResponse<Member>> {
    return this.get(`/organization/${orgId}/teams/${teamId}/members`, query) as Promise<
      PaginatedResponse<Member>
    >;
  }

  async createTeam(orgId: string, dto: CreateTeamDto): Promise<Team> {
    return this.post(`/organization/${orgId}/teams`, dto) as Promise<Team>;
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
    return this.post(`/organization/${orgId}/teams/${teamId}/members`, dto);
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

  async listMembers(orgId: string, query?: PaginationQuery): Promise<PaginatedResponse<Member>> {
    return this.get(`/organization/${orgId}/members`, query) as Promise<PaginatedResponse<Member>>;
  }

  async createUser(orgId: string, dto: CreateUserDto): Promise<Member> {
    return this.post(`/organization/${orgId}/users`, dto) as Promise<Member>;
  }

  async updateMember(orgId: string, userId: string, dto: UpdateMemberDto): Promise<Member> {
    return this.put(`/organization/${orgId}/members/${userId}`, dto) as Promise<Member>;
  }

  async assignRoles(orgId: string, userId: string, roles: string[]): Promise<MessageResponse> {
    return this.post(`/organization/${orgId}/members/${userId}/roles`, {
      roles,
    }) as Promise<MessageResponse>;
  }

  async removeRoles(orgId: string, userId: string, roles: string[]): Promise<MessageResponse> {
    return this.del(`/organization/${orgId}/members/${userId}/roles`, {
      roles,
    }) as Promise<MessageResponse>;
  }

  async removeMembers(orgId: string, memberIds: string[]): Promise<MessageResponse> {
    return this.del(`/organization/${orgId}/members`, { memberIds }) as Promise<MessageResponse>;
  }

  async inviteUser(orgId: string, dto: InviteUserDto): Promise<MessageResponse> {
    return this.post(`/organization/${orgId}/invitations`, dto) as Promise<MessageResponse>;
  }

  // =========================================================================
  // Audit Logs
  // =========================================================================

  async getAuditLogs(query?: AuditLogQuery): Promise<PaginatedResponse<AuditLog>> {
    return this.get('/organization/audit-logs', query) as Promise<PaginatedResponse<AuditLog>>;
  }

  async getAuditLog(logId: string): Promise<AuditLog> {
    return this.get(`/organization/audit-logs/${logId}`) as Promise<AuditLog>;
  }

  async exportAuditLogs(dto: ExportAuditLogsDto): Promise<AuditExport> {
    return this.post('/organization/audit-logs/export', dto) as Promise<AuditExport>;
  }

  async previewAuditExport(dto: PreviewExportDto): Promise<unknown> {
    return this.post('/organization/audit-logs/export/preview', dto);
  }

  async getExportHistory(query?: ExportHistoryQuery): Promise<PaginatedResponse<AuditExport>> {
    return this.get('/organization/audit-logs/exports', query) as Promise<
      PaginatedResponse<AuditExport>
    >;
  }

  async getExport(exportId: string): Promise<AuditExport> {
    return this.get(`/organization/audit-logs/export/${exportId}`) as Promise<AuditExport>;
  }

  async downloadExport(exportId: string): Promise<unknown> {
    return this.get(`/organization/audit-logs/export/${exportId}/download`);
  }

  async deleteExport(exportId: string): Promise<MessageResponse> {
    return this.del(`/organization/audit-logs/export/${exportId}`) as Promise<MessageResponse>;
  }

  // =========================================================================
  // User
  // =========================================================================

  async getUserRoles(): Promise<UserRole[]> {
    return this.get('/user/roles') as Promise<UserRole[]>;
  }

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
    return this.get('/health');
  }

  // =========================================================================
  // API keys - live backend, org-scoped, gated on create/read/update/delete:api_key
  // =========================================================================

  async listApiKeys(): Promise<PaginatedResponse<ApiKey>> {
    return this.get('/api-key') as Promise<PaginatedResponse<ApiKey>>;
  }

  async createApiKey(dto: CreateApiKeyDto): Promise<ApiKey> {
    return this.post('/api-key', dto) as Promise<ApiKey>;
  }

  async getApiKey(id: string): Promise<ApiKey> {
    return this.get(`/api-key/${id}`) as Promise<ApiKey>;
  }

  async updateApiKey(id: string, dto: UpdateApiKeyDto): Promise<ApiKey> {
    return this.patch(`/api-key/${id}`, dto) as Promise<ApiKey>;
  }

  async deleteApiKey(id: string): Promise<MessageResponse> {
    return this.del(`/api-key/${id}`) as Promise<MessageResponse>;
  }

  // =========================================================================
  // Webhooks - live backend, gated on create/read/update/delete:webhook
  // =========================================================================

  async listWebhooks(): Promise<PaginatedResponse<Webhook>> {
    return this.get('/webhook') as Promise<PaginatedResponse<Webhook>>;
  }

  async createWebhook(dto: CreateWebhookDto): Promise<Webhook> {
    return this.post('/webhook', dto) as Promise<Webhook>;
  }

  async getWebhook(id: string): Promise<Webhook> {
    return this.get(`/webhook/${id}`) as Promise<Webhook>;
  }

  async updateWebhook(id: string, dto: UpdateWebhookDto): Promise<Webhook> {
    return this.patch(`/webhook/${id}`, dto) as Promise<Webhook>;
  }

  async deleteWebhook(id: string): Promise<MessageResponse> {
    return this.del(`/webhook/${id}`) as Promise<MessageResponse>;
  }

  async getWebhookDeliveries(
    id: string,
    query?: PaginationQuery,
  ): Promise<PaginatedResponse<WebhookDelivery>> {
    return this.get(`/webhook/${id}/deliveries`, query) as Promise<
      PaginatedResponse<WebhookDelivery>
    >;
  }

  async regenerateWebhookSecret(id: string): Promise<{ secret: string } & MessageResponse> {
    return this.post(`/webhook/${id}/regenerate-secret`) as Promise<
      { secret: string } & MessageResponse
    >;
  }

  async testWebhook(id: string): Promise<MessageResponse> {
    return this.post(`/webhook/${id}/test`) as Promise<MessageResponse>;
  }

  // =========================================================================
  // SSO - live backend, gated on manage:sso
  // =========================================================================

  async getSsoConfig(): Promise<unknown> {
    return this.get('/sso');
  }

  async deleteSsoConfig(): Promise<MessageResponse> {
    return this.del('/sso') as Promise<MessageResponse>;
  }

  async getSsoStatus(): Promise<SsoStatus> {
    return this.get('/sso/status') as Promise<SsoStatus>;
  }

  async getSsoMetadata(): Promise<unknown> {
    return this.get('/sso/metadata');
  }

  async configureSsoOidc(dto: ConfigureOidcDto): Promise<MessageResponse> {
    return this.post('/sso/oidc', dto) as Promise<MessageResponse>;
  }

  async configureSsoSaml(dto: ConfigureSamlDto): Promise<MessageResponse> {
    return this.post('/sso/saml', dto) as Promise<MessageResponse>;
  }

  async verifySsoConfig(): Promise<MessageResponse> {
    return this.post('/sso/verify') as Promise<MessageResponse>;
  }

  async enforceSso(dto: EnforceSsoDto = {}): Promise<MessageResponse> {
    return this.put('/sso/enforce', dto) as Promise<MessageResponse>;
  }

  // =========================================================================
  // Miscellaneous live-backend endpoints (unwrapped pre-port)
  // =========================================================================

  async getCsrfToken(): Promise<CsrfToken> {
    return this.get('/auth/csrf') as Promise<CsrfToken>;
  }

  async getDemoSetupStatus(): Promise<unknown> {
    return this.get('/organization/demo-setup-status');
  }

  async getOrgFeatures(organizationId: string): Promise<OrgFeatures> {
    return this.get(`/organization/${organizationId}/features`) as Promise<OrgFeatures>;
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
    await this.ensureValidToken();

    if (this.rateLimiter) {
      await this.rateLimiter.acquire();
    }

    let url = `${this.baseUrl}${path}`;
    if (options?.params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(options.params)) {
        if (value !== undefined && value !== null) {
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
  private async get(path: string, params?: any): Promise<unknown> {
    return this.request('GET', path, { params });
  }

  private async post(path: string, data?: unknown): Promise<unknown> {
    return this.request('POST', path, { data });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async put(path: string, data?: unknown, params?: any): Promise<unknown> {
    return this.request('PUT', path, { data, params });
  }

  private async patch(path: string, data?: unknown): Promise<unknown> {
    return this.request('PATCH', path, { data });
  }

  private async del(path: string, data?: unknown): Promise<unknown> {
    return this.request('DELETE', path, { data });
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
