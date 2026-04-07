// ---------------------------------------------------------------------------
// Query helpers
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

// ---------------------------------------------------------------------------
// AIVSS configuration
// ---------------------------------------------------------------------------

export interface BaseSecurityConfig {
  /** Attack Vector: 1-4 (Network to Physical) */
  attack_vector: number;
  /** Attack Complexity: 1-2 (Low to High) */
  attack_complexity: number;
  /** Privileges Required: 1-3 (None to High) */
  privileges_required: number;
  /** User Interaction: 1-2 (None to Required) */
  user_interaction: number;
  /** Scope: 1-2 (Unchanged to Changed) */
  scope: number;
}

export interface AISpecificConfig {
  /** Model Robustness: 1-5 (Very High to Very Low) */
  model_robustness: number;
  /** Data Sensitivity: 1-5 (Public to Critical) */
  data_sensitivity: number;
  /** Ethical Impact: 1-5 (Negligible to Severe) */
  ethical_impact: number;
  /** Decision Criticality: 1-5 (Non-critical to Safety-critical) */
  decision_criticality: number;
  /** Adaptability: 1-5 (Static to Highly adaptive) */
  adaptability: number;
}

export interface ImpactConfig {
  /** Confidentiality Impact: 1-5 (None to Critical) */
  confidentiality_impact: number;
  /** Integrity Impact: 1-5 (None to Critical) */
  integrity_impact: number;
  /** Availability Impact: 1-5 (None to Critical) */
  availability_impact: number;
  /** Safety Impact: 1-5 (None to Critical) */
  safety_impact: number;
}

export interface AivssConfig {
  /** Base Security parameters (25% weight) */
  base_security: BaseSecurityConfig;
  /** AI-Specific parameters (45% weight) */
  ai_specific: AISpecificConfig;
  /** Impact parameters (30% weight) */
  impact: ImpactConfig;
}

// ---------------------------------------------------------------------------
// Goal Alignment
// ---------------------------------------------------------------------------

export interface GoalAlignmentConfig {
  /** Alignment threshold percentage (0-100) */
  alignment_threshold: number;
  /** LlamaFirewall model used for drift detection */
  llama_firewall_model: 'gpt-4o-mini' | 'gpt-4o' | 'claude-3-haiku';
  /** Action when drift is detected */
  drift_detection_action: 'alert_only' | 'constrain' | 'terminate';
  /** How often to evaluate goal alignment */
  evaluation_frequency?:
    | 'every_action'
    | 'every_5_actions'
    | 'every_10_actions'
    | 'session_end_only';
}

// ---------------------------------------------------------------------------
// Agent DTOs
// ---------------------------------------------------------------------------

export interface CreateAgentDto {
  agent_name: string;
  agent_type?: string;
  model_name?: string;
  description?: string;
  config?: Record<string, unknown>;
  team_ids: string[];
  tags?: string[];
  icon: string;
  key?: string;
  attestation_mode?: 'kms' | 'external';
  attestation_domain?: string;
  attestation_token?: string;
  aivss_config: AivssConfig;
  goal_alignment_config: GoalAlignmentConfig;
}

export interface UpdateAgentDto {
  agent_name?: string;
  agent_type?: string;
  model_name?: string;
  description?: string;
  config?: Record<string, unknown>;
  tags?: string[];
  team_ids?: string[];
}

// ---------------------------------------------------------------------------
// Guardrail DTOs
// ---------------------------------------------------------------------------

export type TrustImpact = 'none' | 'low' | 'medium' | 'high';

export interface CreateGuardrailDto {
  guardrail_type: string;
  name: string;
  description?: string;
  processing_stage: string;
  params?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  trust_impact?: TrustImpact;
  trust_threshold?: number | null;
}

export interface UpdateGuardrailDto {
  guardrail_type?: string;
  name?: string;
  description?: string;
  processing_stage?: string;
  is_active?: boolean;
  params?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  trust_impact?: TrustImpact;
  trust_threshold?: number | null;
}

// ---------------------------------------------------------------------------
// Policy DTOs
// ---------------------------------------------------------------------------

export interface CreatePolicyDto {
  name: string;
  description?: string;
  rego_code: string;
  input: Record<string, unknown>;
  config?: Record<string, unknown>;
  trust_impact?: TrustImpact;
  trust_threshold?: number | null;
}

export interface UpdatePolicyDto {
  is_active: boolean;
  trust_impact?: TrustImpact;
  trust_threshold?: number | null;
}

// ---------------------------------------------------------------------------
// Behavior Rule DTOs
// ---------------------------------------------------------------------------

export type BehaviorTrigger =
  | 'http_get'
  | 'http_post'
  | 'http_put'
  | 'http_patch'
  | 'http_delete'
  | 'http'
  | 'llm_completion'
  | 'llm_embedding'
  | 'llm_tool_call'
  | 'database_select'
  | 'database_insert'
  | 'database_update'
  | 'database_delete'
  | 'database_query'
  | 'file_read'
  | 'file_write'
  | 'file_open'
  | 'file_delete'
  | 'internal';

/**
 * Behavior rule verdict - matches backend VerdictEnum exactly:
 *   0 = ALLOW
 *   2 = REQUIRE_APPROVAL (requires approval_timeout >= 1)
 *   3 = BLOCK
 *   4 = HALT
 *
 * Note: 1 = CONSTRAIN is defined in backend. Core doesn't produce it but behavior rules can use it.
 */
export type BehaviorVerdict = 0 | 1 | 2 | 3 | 4;

export interface CreateBehaviorRuleDto {
  rule_name: string;
  description?: string;
  priority: number;
  trigger: BehaviorTrigger;
  states: BehaviorTrigger[];
  dependency_base_rule_id?: string;
  time_window: number;
  verdict: BehaviorVerdict;
  reject_message: string;
  approval_timeout?: number;
  trust_impact?: TrustImpact;
  trust_threshold?: number | null;
}

export interface UpdateBehaviorRuleDto {
  rule_name: string;
  description?: string;
  priority: number;
  trigger: BehaviorTrigger;
  states: BehaviorTrigger[];
  dependency_base_rule_id?: string;
  time_window: number;
  verdict: BehaviorVerdict;
  reject_message: string;
  approval_timeout?: number;
  trust_impact?: TrustImpact;
  trust_threshold?: number | null;
  change_log: string;
}

// ---------------------------------------------------------------------------
// Test / Evaluate DTOs
// ---------------------------------------------------------------------------

export interface TestGuardrailDto {
  guardrail_type?: string;
  params?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  logs?: Record<string, unknown>;
}

export interface EvaluateRegoDto {
  policy: string;
  input: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Organization DTOs
// ---------------------------------------------------------------------------

export interface UpdateOrgSettingsDto {
  name?: string;
  domain?: string;
  timezone?: 'America/New_York (EST)' | 'America/Los_Angeles (PST)' | 'Europe/London (GMT)';
}

export interface CreateUserDto {
  username: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  password: string;
  roles: Array<{ id: string; name: string }>;
}

export interface UpdateMemberDto {
  role: string;
  team_ids: string[];
}

export interface InviteUserDto {
  email: string;
  roles?: string[];
}

export interface UpdateTeamDto {
  name?: string;
  description?: string;
  icon?: string;
}

// ---------------------------------------------------------------------------
// Audit export DTOs
// ---------------------------------------------------------------------------

export type AuditEventType =
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

export interface ExportAuditLogsDto {
  exportName: string;
  eventTypes?: AuditEventType[];
  actorId?: string;
  result?: 'success' | 'failed' | 'denied' | 'warning' | 'approved' | 'allowed';
  search?: string;
  startDate?: string;
  endDate?: string;
}

export interface PreviewExportDto {
  eventTypes?: AuditEventType[];
  startDate?: string;
  endDate?: string;
}

// ---------------------------------------------------------------------------
// Agent violation query (body-based)
// ---------------------------------------------------------------------------

export interface GetAgentViolationsQuery extends PaginationQuery {
  pattern?: string;
  sourceType?: string;
}

// ---------------------------------------------------------------------------
// Change password DTO
// ---------------------------------------------------------------------------

export interface ChangePasswordDto {
  currentPassword: string;
  newPassword: string;
  orgId: string;
}
