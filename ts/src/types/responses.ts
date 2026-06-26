// Response types for the OpenboxBackend API.
//
// Backend NestJS controllers don't carry `@ApiOkResponse({ type: ... })`
// annotations on most endpoints, so the auto-generated OpenAPI document
// has no response schemas. The SDK closes that gap by authoring the
// shapes in `specs/typespec/backend/responses.tsp`; the shared TypeSpec
// emitter surfaces them as named entries in `Backend.components`.
//
// Each export below is a one-line alias of the generated schema. When
// the upstream backend grows `@ApiOkResponse` decorators, drop the
// matching model from `responses.tsp`; these aliases keep working
// because the TypeSpec emitter will pick the schema up from the canonical
// contract instead.

import type { components } from './generated/backend.js';

type Schema<K extends keyof components['schemas']> = components['schemas'][K];

// ---------------------------------------------------------------------------
// Generic response wrappers
// ---------------------------------------------------------------------------

// `PaginatedResponse<T>` is generic and can't round-trip through the
// OpenAPI schema bag (which has no template-binding mechanism). The
// spec's `PaginatedResponse<T>` instantiations show up under composite
// names, so we keep this as a hand-written generic that consumers
// instantiate with the response-row schema.
export interface PaginatedResponse<T> {
  data: T[];
  meta?: { total: number; page: number; perPage: number };
  total?: number;
}

export type MessageResponse = Schema<'MessageResponse'>;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export type UserProfile = Schema<'UserProfile'>;
export type UserRole = Schema<'UserRole'>;

// ---------------------------------------------------------------------------
// Agent + API key
// ---------------------------------------------------------------------------

export type Agent = Schema<'Agent'>;
export type CreateAgentResponse = Schema<'CreateAgentResponse'>;
export type ApiKeyResponse = Schema<'ApiKeyResponse'>;
export type ApiKey = Schema<'ApiKey'>;

// ---------------------------------------------------------------------------
// Guardrail / policy / behavior rule / session
// ---------------------------------------------------------------------------

export type Guardrail = Schema<'Guardrail'>;
export type Policy = Schema<'Policy'>;
export type BehaviorRule = Schema<'BehaviorRule'>;
export type Session = Schema<'Session'>;

// ---------------------------------------------------------------------------
// Trust + AIVSS
// ---------------------------------------------------------------------------

export type TrustHistory = Schema<'TrustHistory'>;
export type TrustEvent = Schema<'TrustEvent'>;
export type TrustTierChange = Schema<'TrustTierChange'>;
export type Assessment = Schema<'Assessment'>;

// ---------------------------------------------------------------------------
// Approval + violation
// ---------------------------------------------------------------------------

export type Approval = Schema<'Approval'>;
export type ApprovalsMetrics = Schema<'ApprovalsMetrics'>;
export type OrgApprovalsResponse = Schema<'OrgApprovalsResponse'>;
export type Violation = Schema<'Violation'>;

// ---------------------------------------------------------------------------
// Organization / team / member / audit
// ---------------------------------------------------------------------------

export type Organization = Schema<'Organization'>;
export type OrgSettings = Schema<'OrgSettings'>;
export type Team = Schema<'Team'>;
export type Member = Schema<'Member'>;
export type AuditLog = Schema<'AuditLog'>;
export type AuditExport = Schema<'AuditExport'>;

// ---------------------------------------------------------------------------
// Webhooks / SSO / org features / CSRF
// ---------------------------------------------------------------------------

export type Webhook = Schema<'Webhook'>;
export type WebhookDelivery = Schema<'WebhookDelivery'>;
export type SsoStatus = Schema<'SsoStatus'>;
export type OrgFeatures = Schema<'OrgFeatures'>;
export type CsrfToken = Schema<'CsrfToken'>;
