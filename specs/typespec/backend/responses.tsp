// Response shapes for the OpenboxBackend API.
//
// Why this file exists: the backend NestJS controllers don't carry
// `@ApiOkResponse({ type: ... })` annotations on most endpoints, so the
// auto-generated `backend.json` emits `responses: { 200: { description:
// "" } }` for every route; zero schema information. Until that gap is
// closed upstream (a separate backend proposal: tag every controller
// method with `@ApiOkResponse`), the SDK side declares the response
// shapes here so they ride through the same codegen pipeline as
// request DTOs.
//
// When the upstream proposal lands, the matching models below get
// dropped and consumers transparently start using the auto-generated
// schemas instead. The `Schema<'X'>` aliases in `ts/types/src/
// responses.ts` won't change.

import "@typespec/http";
import "@typespec/openapi";

using Http;
using OpenAPI;

namespace OpenboxBackend;

// ---------------------------------------------------------------------------
// Generic response wrappers
// ---------------------------------------------------------------------------

/** Pagination meta block returned alongside list responses. */
model PaginationMeta {
  total: int32;
  page: int32;
  perPage: int32;
}

/**
 * Generic `{ data: T[], meta? }` envelope. Most list endpoints return
 * this shape; some carry `total` at the root for back-compat.
 */
model PaginatedResponse<T> {
  data: T[];
  meta?: PaginationMeta;
  total?: int32;
}

/** Plain `{ message: string }` envelope used by mutation acks. */
model MessageResponse {
  message: string;
}

/** OAuth-style token pair returned by `/auth/login` and the refresh endpoint.
 * Same shape as the env-package TokenPair (the env namespace exports it
 * for runtime consumers); declared here so the backend OpenAPI carries
 * it as a named schema. */
model TokenPair {
  accessToken: string;
  /** Optional; Keycloak rotation may be disabled. */
  refreshToken?: string;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** Profile decoded from the active JWT. Bag-shape because the JWT carries
 * realm-specific extra claims the SDK passes through verbatim. */
model UserProfile {
  sub: string;
  email: string;
  name?: string;
  preferred_username?: string;
  email_verified?: boolean;
  /** Active org for the JWT. Absent for users who haven't selected one;
   * downstream consumers that need an org ID fall back to listing
   * accessible agents and reading `Agent.organization_id` from the first
   * row. */
  orgId?: string;
  ...Record<unknown>;
}

/** Single role row inside `UserProfile.roles[]`. */
model UserRole {
  id: string;
  name: string;
  ...Record<unknown>;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

model Agent {
  id: string;
  agent_name: string;
  agent_type?: string;
  model_name?: string;
  description?: string;
  organization_id: string;
  config?: Record<unknown>;
  team_ids?: string[];
  tags?: string[];
  icon?: string;
  trust_score?: float64;
  tier?: string;
  status?: int32;
  created_at?: string;
  updated_at?: string;
  ...Record<unknown>;
}

/** `POST /agent/create` returns the agent + the runtime API key. The
 * key is returned ONCE at this moment; it's never recoverable from
 * `agent get` later. Consumers must persist it immediately. */
model CreateAgentResponse {
  agent: Agent;
  token: string;
}

// ---------------------------------------------------------------------------
// API Key; the runtime obx_live_*/obx_test_* identity for SDK calls.
// ---------------------------------------------------------------------------

model ApiKeyResponse {
  token: string;
  ...Record<unknown>;
}

// ---------------------------------------------------------------------------
// Guardrail
// ---------------------------------------------------------------------------

model Guardrail {
  id: string;
  name: string;
  guardrail_type: string;
  description?: string;
  processing_stage: string;
  is_active: boolean;
  params?: Record<unknown>;
  settings?: Record<unknown>;
  trust_impact?: string;
  trust_threshold?: float64 | null;
  order?: int32;
  ...Record<unknown>;
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

model Policy {
  id: string;
  name: string;
  description?: string;
  rego_code: string;
  input?: Record<unknown>;
  is_active: boolean;
  trust_impact?: string;
  trust_threshold?: float64 | null;
  ...Record<unknown>;
}

// ---------------------------------------------------------------------------
// Behavior Rule
// ---------------------------------------------------------------------------

model BehaviorRule {
  id: string;
  rule_name: string;
  description?: string;
  priority: int32;
  trigger: string;
  states: string[];
  time_window: int32;
  verdict: int32;
  reject_message: string;
  is_active: boolean;
  group_id?: string;
  version?: int32;
  ...Record<unknown>;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

model Session {
  id: string;
  session_id?: string;
  agent_id?: string;
  workflow_id?: string;
  run_id?: string;
  status?: string;
  started_at?: string;

  /**
   * Backend field is `completed_at`; use this, not `ended_at` (which
   * doesn't exist).
   */
  completed_at?: string;

  flagged?: boolean;
  flag_reason?: string;
  detail?: string;
  trust_evaluated_at?: string;
  metadata?: Record<unknown>;
  ...Record<unknown>;
}

// ---------------------------------------------------------------------------
// Trust
// ---------------------------------------------------------------------------

model TrustHistory {
  trust_score: float64;
  tier?: string;
  timestamp?: string;
  ...Record<unknown>;
}

model TrustEvent {
  id: string;
  event_type?: string;
  impact?: float64;
  timestamp?: string;
  ...Record<unknown>;
}

model TrustTierChange {
  id: string;
  from_tier?: string;
  to_tier?: string;
  reason?: string;
  timestamp?: string;
  ...Record<unknown>;
}

// ---------------------------------------------------------------------------
// AIVSS
// ---------------------------------------------------------------------------

model Assessment {
  id: string;
  score?: float64;
  severity?: string;
  timestamp?: string;
  ...Record<unknown>;
}

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

/** Nested agent reference embedded on `Approval`. The backend joins
 *  the originating agent so list views can show its display name
 *  without a second `getAgent` roundtrip. */
model ApprovalAgent {
  agent_name: string;
  ...Record<unknown>;
}

/** Approval metadata captured at the time the action was queued. The
 *  trust tier is the agent's tier as evaluated when the verdict
 *  triggered, NOT its current tier (which may have shifted while the
 *  approval was pending). */
model ApprovalMetadata {
  trust_tier?: int32;
  ...Record<unknown>;
}

model Approval {
  id: string;
  event_id?: string;
  agent_id?: string;
  status?: string;
  action_type?: string;
  /** Wire-side alias for `action_type`. The backend's approval
   *  pipeline historically emitted `activity_type` for the action
   *  category and still does for verdict-triggered approvals; new
   *  paths use `action_type`. Both ride together; clients prefer
   *  `action_type` and fall back. */
  activity_type?: string;
  /** Verdict numeric: 0 = Allow, 1 = Constrain, 2 = Require Approval,
   *  3 = Block, 4 = Halt. Approvals exist only for verdict ≥ 2 in
   *  practice but the field carries the raw value the rule emitted. */
  verdict?: int32;
  /** Free-text rationale attached to the verdict; populated by
   *  guardrail / behavior-rule evaluation. Optional because action-type
   *  approvals (manual queues) carry no automated reason. */
  reason?: string;
  created_at?: string;
  decided_at?: string;
  /** Deadline after which the approval auto-expires. Emitted as an
   *  ISO-8601 timestamp; absent when the rule has no timeout
   *  configured. */
  approval_expired_at?: string;
  agent?: ApprovalAgent;
  metadata?: ApprovalMetadata;
  /** Activity input payload captured at queue time. Shape depends on
   *  the action type; Shell carries `[{ command, cwd }]`, LLM carries
   *  `[{ prompt, model }]`. Mobile + approver UIs pretty-print this
   *  in the detail sheet; CLI surfaces a one-line summary. */
  input?: Record<unknown>;
  /** OpenTelemetry spans from the agent run that triggered the
   *  approval. Approvers use them to show the surrounding trace
   *  context. */
  spans?: Record<unknown>[];
  ...Record<unknown>;
}

/**
 * Counts surfaced alongside `getOrgApprovals`. Backend computes these
 * from the same approvals query so clients don't need a second
 * roundtrip.
 */
model ApprovalsMetrics {
  pending_count?: int32;
  expired_count?: int32;
  ...Record<unknown>;
}

/**
 * `getOrgApprovals` returns `{ approvals, metrics }` (after the
 * `{status,data}` envelope). Backend's organization.service.ts runs
 * the list + count queries in parallel.
 */
model OrgApprovalsResponse {
  approvals: PaginatedResponse<Approval>;
  metrics: ApprovalsMetrics;
}

// ---------------------------------------------------------------------------
// Violation
// ---------------------------------------------------------------------------

model Violation {
  id: string;
  agent_id?: string;
  source_type?: string;
  pattern?: string;
  is_false_positive?: boolean;
  timestamp?: string;
  ...Record<unknown>;
}

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

model Organization {
  id: string;
  name: string;
  domain?: string;
  ...Record<unknown>;
}

model OrgSettings {
  name?: string;
  domain?: string;
  timezone?: string;
  ...Record<unknown>;
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

model Team {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  ...Record<unknown>;
}

// ---------------------------------------------------------------------------
// Member
// ---------------------------------------------------------------------------

model Member {
  id: string;
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  ...Record<unknown>;
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

model AuditLog {
  id: string;
  event_type?: string;
  actor_id?: string;
  result?: string;
  details?: Record<unknown>;
  created_at?: string;
  ...Record<unknown>;
}

model AuditExport {
  id: string;
  export_name?: string;
  status?: string;
  created_at?: string;
  ...Record<unknown>;
}

// ---------------------------------------------------------------------------
// API keys / webhooks / SSO; live backend (post-PR #237). Backend
// doesn't publish response schemas, so these are SDK-side declared.
// ---------------------------------------------------------------------------

model ApiKey {
  id: string;
  name: string;
  permissions: string[];
  valid_from?: string | null;
  expires_at?: string | null;
  ip_whitelist?: string[] | null;
  is_active?: boolean;
  description?: string;
  created_at?: string;
  updated_at?: string;
  last_used_at?: string | null;

  /** Only present on create; the raw `obx_key_*` secret, shown once. */
  key?: string;

  ...Record<unknown>;
}

model Webhook {
  id: string;
  name: string;
  channel: "http" | "slack";
  url: string;
  event_types: string[];
  agent_ids?: string[] | null;
  is_active?: boolean;
  description?: string;
  created_at?: string;
  updated_at?: string;
  ...Record<unknown>;
}

model WebhookDelivery {
  id: string;
  webhook_id: string;
  event_type?: string;
  status?: string;
  status_code?: int32;
  attempt_count?: int32;
  delivered_at?: string;
  ...Record<unknown>;
}

model SsoStatus {
  enabled?: boolean;
  method?: "oidc" | "saml" | null;
  enforced?: boolean;
  ...Record<unknown>;
}

model OrgFeatures is Record<boolean | string | float64 | null>;

model CsrfToken {
  token?: string;
  ...Record<unknown>;
}

/** Result of /organization/register. Backend returns just the
 *  identity pair the FE needs to redirect into the new org; full
 *  Organization model is not in the response. */
model OrganizationRegistrationResult {
  customer_id: string;
  customer_name: string;
}

/** Demo-agent seed status from /organization/demo-setup-status.
 *  Polled by the FE while a fresh org's demo agent is being seeded. */
model DemoSetupStatus {
  status: "completed" | "running" | "failed" | "not_started";
}

/** SSO configuration view from /sso. Returned for both configured and
 *  unconfigured orgs - protocol/displayName/alias drop to null when
 *  no IdP is set up. */
model SsoConfig {
  configured: boolean;
  protocol?: string | null;
  displayName?: string | null;
  enabled: boolean;
  enforced: boolean;
  `alias`?: string;
}

/** SAML/OIDC SP metadata from /sso/metadata, used by customers to
 *  configure their IdP against this Keycloak realm. */
model SsoMetadata {
  entityId: string;
  acsUrl: string;
  singleLogoutUrl: string;
  metadataUrl: string;
  oidcRedirectUri: string;
}

/** Per-penalty row inside TrustRecoveryStatus.recovery.penalties. */
model TrustPenalty {
  penalty_id: string;
  component: string;
  trust_impact: string;
  penalty_amount: float64;
  session_position: int32;
  sessions_until_cleared: int32;
}

/** Trust-recovery status from /agent/{id}/trust/recovery-status. When
 *  has_penalty=false the recovery block is omitted; otherwise it
 *  carries the active penalty count + per-penalty rows + projection
 *  for when the agent's trust will fully clear. */
model TrustRecoveryStatus {
  has_penalty: boolean;
  recovery?: {
    window_size: int32;
    active_count: int32;
    total_penalty_amount: float64;
    penalties: TrustPenalty[];
    next_clearance_in: int32;
    fully_clean_in: int32;
  };
}

/** AIVSS calculation result from POST /agent/aivss. Computed from the
 *  request body's AivssConfig; no persistence. */
model AivssCalculationResult {
  aivss_score: float64;
  breakdown: Record<float64>;
  trust_score: float64;
  trust_tier: int32;
  trust_tier_name: string;
}

/** Team-stats shape from /organization/{orgId}/teams/stats. */
model TeamStats {
  total_teams: int32;
  new_teams_this_month: int32;
  total_agents: int32;
  active_agents: int32;
  total_team_members: int32;
}

/** Counters from /agent/{id}/sessions/{sessionId}/goal-alignment-stats:
 *  how many evaluations were checked vs how many drifted in the
 *  session window. */
model SessionGoalAlignmentStats {
  total_checked: int32;
  total_drifted: int32;
}

/** Single goal-drift event from /agent/{id}/goal-alignment/recent-drifts.
 *  Backend returns an array of these, sorted by evaluated_at DESC. */
model RecentDriftEvent {
  session_id: string;
  governance_event_id: string;
  reason: Record<unknown> | null;
  evaluated_at: string;
  alignment_percentage: int32;
}

/** Counter pair on /agent/{id}/approvals/metrics. */
model AgentApprovalsMetrics {
  pending: int32;
  approved: int32;
  rejected: int32;
  approvalRate: int32;
}

/** Counters + rates on /agent/{id}/behavior/metrics. */
model AgentBehaviorMetrics {
  active: int32;
  violations_today: int32;
  compliance_rate: float64;
  pending_approvals: int32;
}

/** Guardrail summary on /agent/{id}/guardrails/metrics. */
model GuardrailMetricsResult {
  active_guardrails: int32;
  violations_today: int32;
  protection_rate: float64;
  avg_response_time_ms: float64;
  /** Time-series for violations; backend returns the row shape opaquely. */
  violations_trend: Record<unknown>[];
  /** {[type]: rate} aggregate. */
  trigger_rate_by_type: Record<float64>;
  latency_percentiles: Record<float64>;
  evaluations_per_sec: float64;
}

/** Insight rollup on /agent/{id}/insights/metrics. */
model InsightMetricsResult {
  violation: {
    total: int32;
    violations: Record<unknown>[];
  };
  tier_changes: {
    total: int32;
  };
}

/** Policy summary on /agent/{id}/policies/metrics. */
model PolicyMetricsResult {
  total_evaluations: int32;
  compliance_rate: float64;
  avg_latency_ms: float64;
  decision_distribution: Record<int32>;
  timeline: Record<unknown>[];
  top_rules_hit: Record<unknown>[];
}

/** Per-day point on /agent/{id}/goal-alignment/trend. */
model GoalAlignmentTrendPoint {
  date: string;
  total_evaluations: int32;
  aligned_count: int32;
  drifted_count: int32;
  alignment_percentage: float64;
}

/** Org-wide approvals metrics on /organization/{id}/approvals/metrics. */
model OrgApprovalsMetrics {
  pending: int32;
  approved_today: int32;
  rejected_today: int32;
  expired_today: int32;
  avg_time: float64;
  avg_change: float64;
}

/** Composite agent metrics on /agent/metrics. Three opaque sub-rollups
 *  (agent counts, guardrail violations, policy violations) - the
 *  per-section shapes are dashboard-customized. */
model AgentsMetricsResult {
  agent: Record<unknown>;
  guardrail: Record<unknown>;
  policy: Record<unknown>;
}

/** Observability rollup on /agent/{id}/observability. The shape is a
 *  large dashboard composite - invocations, tokens, tools, latency
 *  percentiles + distribution, models timeline + stats + costs,
 *  errors. Keeping the top-level keys typed; sub-shapes are opaque
 *  because they're FE-shape-customized. */
model ObservabilityResult {
  invocations: Record<unknown>;
  tokens: Record<unknown>;
  tools: Record<unknown>;
  latency: Record<unknown>;
  models: Record<unknown>;
  errors: Record<unknown>;
}

/** Result of POST /organization/audit-logs/export/preview. Counter +
 *  echo of the filter the user passed. */
model AuditExportPreview {
  count: int32;
  timeRange: {
    startDate?: string;
    endDate?: string;
  };
  eventTypes: string[];
}

/** Result of GET /organization/audit-logs/export/{id}/download. The
 *  downloadable URL plus its short-lived TTL. */
model AuditExportDownload {
  downloadUrl: string;
  expiresIn: int32;
}

/** Dashboard rollups under /organization/{id}/dashboard{,/...}. The
 *  shapes are FE-customized aggregates of multiple metric tables; the
 *  spec captures them as opaque Record<string, unknown> until the FE
 *  consumers are extracted into typed models. */
model DashboardResult is Record<unknown>;

/** Single reasoning-trace entry from /agent/{id}/sessions/{sessionId}/
 *  reasoning-trace. The endpoint returns an array of these, ordered
 *  by governance-event created_at ASC. */
model ReasoningTraceEntry {
  governance_event_id: string;
  event_type?: string | null;
  activity_type?: string | null;
  signal_name?: string | null;
  created_at?: string | null;
  duration_ms?: int32 | null;
  goal_alignment_checked?: boolean;
  goal_drift?: boolean;
  goal_alignment_detail?: Record<unknown> | null;
  trust_score?: float64 | null;
  trust_tier?: int32 | null;
  alignment_consistency?: float64 | null;
}
