// Response shapes for the OpenboxBackend API.
//
// Why this file exists: the backend NestJS controllers don't carry
// `@ApiOkResponse({ type: ... })` annotations on most endpoints, so the
// auto-generated `backend.json` emits `responses: { 200: { description:
// "" } }` for every route - zero schema information. Until that gap is
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
 * Same shape as `@openbox/env`'s TokenPair (the env namespace exports it for
 * runtime consumers); declared here so the backend OpenAPI carries it as a
 * named schema. */
model TokenPair {
  accessToken: string;
  /** Optional - Keycloak rotation may be disabled. */
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
// API Key - the runtime obx_live_*/obx_test_* identity for SDK calls.
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
   * Backend field is `completed_at` - use this, not `ended_at` (which
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

model Approval {
  id: string;
  event_id?: string;
  agent_id?: string;
  status?: string;
  action_type?: string;
  created_at?: string;
  decided_at?: string;
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
// API keys / webhooks / SSO - live backend (post-PR #237). Backend
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

  /** Only present on create - the raw `obx_key_*` secret, shown once. */
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
