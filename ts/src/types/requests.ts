// Request DTOs and query helpers for the backend API.
//
// Every wire DTO here is a type alias of the corresponding entry in
// `Backend.components['schemas']` (the auto-generated openapi-typescript
// output of specs/generated/openapi3/OpenboxBackend.json). This file
// owns no shape information; only the friendly name → schema mapping.
// When TypeSpec changes, run `npm run specs:all` and these aliases
// update automatically.
//
// The query-helper interfaces at the top stay hand-written: NestJS
// flattens `@Query` parameters into individual OpenAPI entries
// instead of bundling them as a DTO, so the OpenAPI never carries
// these shapes. They live here as a consumer-side convenience layer.

import type { components } from './generated/backend.js';

type Schema<K extends keyof components['schemas']> = components['schemas'][K];

// ---------------------------------------------------------------------------
// Query helpers (consumer convenience; not on the wire as named DTOs)
// ---------------------------------------------------------------------------

export interface PaginationQuery {
  page?: number;
  perPage?: number;
}

export interface MetricsQuery {
  fromTime?: string;
  toTime?: string;
}

export interface ApprovalListQuery extends PaginationQuery {
  search?: string;
  status?: 'pending' | 'approved' | 'rejected' | 'expired';
  tiers?: string[];
  agent_id?: string;
  team_ids?: string[];
  // Free-form activity_type values (governance_events.activity_type).
  // Backend support added in proposal/approvals-activity-type-filter;
  // until that ships, the param is silently ignored server-side and
  // consumers should keep filtering locally.
  activity_types?: string[];
  fromTime?: string;
  toTime?: string;
  organization_id?: string;
}

export interface SessionListQuery extends PaginationQuery {
  status?: 'pending' | 'completed' | 'failed' | 'blocked' | 'halted';
  fromTime?: string;
  toTime?: string;
  duration?: '<1min' | '1-5mins' | '5-15mins' | '>15mins';
  search?: string;
}

export interface AuditLogQuery extends PaginationQuery {
  eventType?:
    | 'policy_change'
    | 'guardrail_change'
    | 'agent_session'
    | 'agent_risk_configuration_change'
    | 'agent_goal_alignment_configuration_change'
    | 'role_change'
    | 'security_event'
    | 'settings_update'
    | 'team_management'
    | 'member_management'
    | 'invitation';
  actorId?: string;
  result?: 'success' | 'failed' | 'denied' | 'warning' | 'approved' | 'allowed';
  search?: string;
  startDate?: string;
  endDate?: string;
}

export interface ExportHistoryQuery extends PaginationQuery {
  status?: 'pending' | 'processing' | 'completed' | 'failed';
  startDate?: string;
  endDate?: string;
}

export interface GetAgentViolationsQuery extends PaginationQuery {
  fromTime?: string;
  toTime?: string;
  search?: string;
  pattern?: string;
  status?: string;
  sourceType?: string;
  // Free-form activity_type values (governance_events.activity_type).
  activity_types?: string[];
}

// ---------------------------------------------------------------------------
// AIVSS configuration
// ---------------------------------------------------------------------------

export type BaseSecurityConfig = Schema<'BaseSecurityDto'>;
export type AISpecificConfig = Schema<'AISpecificDto'>;
export type ImpactConfig = Schema<'ImpactDto'>;
export type AivssConfig = Schema<'AivssConfigDto'>;
export type GoalAlignmentConfig = Schema<'GoalAlignmentConfigDto'>;

// ---------------------------------------------------------------------------
// Auth + onboarding DTOs (/auth/*, /organization/register, ...)
// ---------------------------------------------------------------------------

export type LoginDto = Schema<'LoginDto'>;
export type ForgotPasswordDto = Schema<'ForgotPasswordDto'>;
export type ResetPasswordDto = Schema<'ResetPasswordDto'>;
export type ChangePasswordDto = Schema<'ChangePasswordDto'>;
export type CreateOrganizationDto = Schema<'CreateOrganizationDto'>;
export type SendWelcomeEmailDto = Schema<'SendWelcomeEmailDto'>;

// ---------------------------------------------------------------------------
// Agent CRUD
// ---------------------------------------------------------------------------

export type CreateAgentDto = Schema<'CreateAgentDto'>;
export type UpdateAgentDto = Schema<'UpdateAgentDto'>;

// TrustImpact isn't in the backend OpenAPI; kept hand-written until
// the Aivss/trust schemas type the field.
export type TrustImpact = 'none' | 'low' | 'medium' | 'high';

// ---------------------------------------------------------------------------
// Guardrails / policies / behavior rules
// ---------------------------------------------------------------------------

export type CreateGuardrailDto = Schema<'CreateGuardrailDto'>;
export type UpdateGuardrailDto = Schema<'UpdateGuardrailDto'>;
export type CreatePolicyDto = Schema<'CreatePolicyDto'>;
export type UpdatePolicyDto = Schema<'UpdatePolicyDto'>;

// BehaviorTrigger / BehaviorVerdict aren't typed in the OpenAPI today.
// Kept hand-written until a backend proposal tightens those enums.
export type BehaviorTrigger =
  | 'http_request'
  | 'db_query'
  | 'file_operation'
  | 'function_call'
  | 'on_workflow_completed'
  | 'on_workflow_failed'
  | 'on_workflow_started'
  | 'on_signal_received'
  | 'temporal_workflow_event'
  | 'on_activity_started'
  | 'on_activity_completed'
  | 'on_activity_input'
  | 'on_activity_output'
  | 'on_signal'
  | 'on_query'
  | 'on_timer'
  | 'on_message'
  | 'on_error'
  | 'on_state_change'
  | 'shell_execution'
  | 'internal'
  | 'mcp_tool_call';

export type BehaviorVerdict = 0 | 1 | 2 | 3 | 4;

export type CreateBehaviorRuleDto = Schema<'CreateBehaviorRuleDto'>;
export type UpdateBehavioralRuleDto = Schema<'UpdateBehavioralRuleDto'>;
export type UpdateBehaviorRuleDto = UpdateBehavioralRuleDto;

export type TestGuardrailDto = Schema<'TestGuardrailDto'>;
export type EvaluateRegoDto = Schema<'EvaluateRegoDto'>;

// ---------------------------------------------------------------------------
// Organization / users / teams / members
// ---------------------------------------------------------------------------

export type UpdateOrgSettingsDto = Schema<'UpdateOrganizationSettingsDto'>;
export type CreateUserDto = Schema<'CreateUserDto'>;
export type UpdateMemberDto = Schema<'UpdateMemberDto'>;
export type InviteUserDto = Schema<'InviteUserDto'>;
export type AssignRolesDto = Schema<'AssignRolesDto'>;
export type RemoveMembersDto = Schema<'RemoveMembersDto'>;
export type CreateTeamDto = Schema<'CreateTeamDto'>;
export type UpdateTeamDto = Schema<'UpdateTeamDto'>;
export type DeleteTeamsDto = Schema<'DeleteTeamsDto'>;
export type AddTeamMembersDto = Schema<'AddTeamMembersDto'>;
export type DeleteTeamMembersDto = Schema<'DeleteTeamMembersDto'>;

// ---------------------------------------------------------------------------
// Audit log export
// ---------------------------------------------------------------------------

export type ExportAuditLogsDto = Schema<'ExportAuditLogsDto'>;
export type PreviewExportDto = Schema<'PreviewExportDto'>;

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

export type CreateApiKeyDto = Schema<'CreateApiKeyDto'>;
export type UpdateApiKeyDto = Schema<'UpdateApiKeyDto'>;

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export type CreateWebhookDto = Schema<'CreateWebhookDto'>;
export type UpdateWebhookDto = Schema<'UpdateWebhookDto'>;

// ---------------------------------------------------------------------------
// SSO
// ---------------------------------------------------------------------------

// The backend's ConfigureOidcDto / ConfigureSamlDto / EnforceSsoDto are
// published as empty objects in the current OpenAPI document; they accept any shape.
// Typed as open records until the server stabilizes the contract.
export type ConfigureOidcDto = Record<string, unknown>;
export type ConfigureSamlDto = Record<string, unknown>;
export type EnforceSsoDto = Record<string, unknown>;
