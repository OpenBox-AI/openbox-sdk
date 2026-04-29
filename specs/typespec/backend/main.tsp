import "@typespec/http";
import "@typespec/openapi";
import "@typespec/openapi3";
import "./responses.tsp";

using Http;
using OpenAPI;

/** OpenBox Backend API Documentation */
@service(#{ title: "OpenBox API" })
@info(#{ version: "1.0", contact: #{} })
namespace OpenboxBackend;

model LoginDto {
  realm: string;
  username: string;
  password: string;
  recaptchaToken: string;
}

model LogoutDto {}

model ForgotPasswordDto {
  email: string;
  realm: string;
}

model ResetPasswordDto {
  token: string;
  newPassword: string;
}

model ChangePasswordDto {
  currentPassword: string;
  newPassword: string;
  orgId: string;
}

model RefreshDto {}

model BaseSecurityDto {
  /** Attack Vector: 1-4 (Network to Physical) */
  @minValue(1) @maxValue(4) attack_vector: numeric;

  /** Attack Complexity: 1-2 (Low to High) */
  @minValue(1) @maxValue(2) attack_complexity: numeric;

  /** Privileges Required: 1-3 (None to High) */
  @minValue(1) @maxValue(3) privileges_required: numeric;

  /** User Interaction: 1-2 (None to Required) */
  @minValue(1) @maxValue(2) user_interaction: numeric;

  /** Scope: 1-2 (Unchanged to Changed) */
  @minValue(1) @maxValue(2) scope: numeric;
}

model AISpecificDto {
  /** Model Robustness: 1-5 (Very High to Very Low) */
  @minValue(1) @maxValue(5) model_robustness: numeric;

  /** Data Sensitivity: 1-5 (Public to Critical) */
  @minValue(1) @maxValue(5) data_sensitivity: numeric;

  /** Ethical Impact: 1-5 (Negligible to Severe) */
  @minValue(1) @maxValue(5) ethical_impact: numeric;

  /** Decision Criticality: 1-5 (Non-critical to Safety-critical) */
  @minValue(1) @maxValue(5) decision_criticality: numeric;

  /** Adaptability: 1-5 (Static to Highly adaptive) */
  @minValue(1) @maxValue(5) adaptability: numeric;
}

model ImpactDto {
  /** Confidentiality Impact: 1-5 (None to Critical) */
  @minValue(1) @maxValue(5) confidentiality_impact: numeric;

  /** Integrity Impact: 1-5 (None to Critical) */
  @minValue(1) @maxValue(5) integrity_impact: numeric;

  /** Availability Impact: 1-5 (None to Critical) */
  @minValue(1) @maxValue(5) availability_impact: numeric;

  /** Safety Impact: 1-5 (None to Critical) */
  @minValue(1) @maxValue(5) safety_impact: numeric;
}

model AivssConfigDto {
  /** Base Security parameters (25% weight) */
  base_security: BaseSecurityDto;

  /** AI-Specific parameters (45% weight) */
  ai_specific: AISpecificDto;

  /** Impact parameters (30% weight) */
  impact: ImpactDto;
}

model CreateAivssConfigDto {
  /** Base Security parameters (25% weight) */
  base_security: BaseSecurityDto;

  /** AI-Specific parameters (45% weight) */
  ai_specific: AISpecificDto;

  /** Impact parameters (30% weight) */
  impact: ImpactDto;
}

model GoalAlignmentConfigDto {
  /** Alignment threshold percentage */
  @minValue(0) @maxValue(100) alignment_threshold: numeric;

  /** LlamaFirewall model used for drift detection */
  llama_firewall_model: "gpt-4o-mini" | "gpt-4o" | "claude-3-haiku";

  /** Action when drift is detected */
  drift_detection_action: "alert_only" | "constrain" | "terminate";

  /** How often to evaluate goal alignment */
  evaluation_frequency?:
    | "every_action"
    | "every_5_actions"
    | "every_10_actions"
    | "session_end_only" = "every_action";
}

model CreateAgentDto {
  /** Name of the agent */
  agent_name: string;

  /** Type of the agent */
  agent_type?: string;

  /** Model name used by the agent */
  model_name?: string;

  /** Description of the agent */
  description?: string;

  /** Configuration object for the agent */
  config?: {};

  /** Array of team IDs */
  team_ids: string[];

  /** Array of tags for categorizing the agent */
  tags?: string[];

  /** Icon URL of agent */
  icon: string;

  /** Agent API key with obx_live_ or obx_test_ prefix */
  key?: string;

  /** Attestation mode: kms (AWS KMS) or external (external server) */
  attestation_mode?: "kms" | "external" = "kms";

  /** External attestation server domain (required when attestation_mode is external) */
  attestation_domain?: string;

  /** Bearer token for external attestation server (optional when attestation_mode is external) */
  attestation_token?: string;

  /** AIVSS baseline trust parameters configuration */
  aivss_config: CreateAivssConfigDto;

  /** Goal alignment & drift detection configuration */
  goal_alignment_config: GoalAlignmentConfigDto;
}

model UpdateAgentDto {
  /** Name of the agent */
  agent_name?: string;

  /** Type of the agent */
  agent_type?: string;

  /** Model name used by the agent */
  model_name?: string;

  /** Description of the agent */
  description?: string;

  /** Configuration object for the agent */
  config?: {};

  /** Array of tags for categorizing the agent */
  tags?: string[];

  /** Array of team IDs */
  team_ids?: string[];
}

model GetAgentViolationsDto {
  /** Page number (starts from 0) */
  @minValue(0) page?: numeric;

  /** Number of items per page */
  @minValue(1) perPage?: numeric = 10;

  /** Filter violations by pattern */
  @maxLength(255) pattern?: string;

  /** Source type of violations */
  sourceType?: string;
}

model MarkFalsePositiveDto {
  /** Source type of violations */
  sourceType: string;
}

model UpdateAivssConfigDto {
  /** Base Security parameters (25% weight) */
  base_security: BaseSecurityDto;

  /** AI-Specific parameters (45% weight) */
  ai_specific: AISpecificDto;

  /** Impact parameters (30% weight) */
  impact: ImpactDto;
}

model UpdateAgentAivssConfigDto {
  /** AIVSS baseline trust parameters configuration */
  aivss_config: UpdateAivssConfigDto;

  /** Reason for change AIVSS configuration */
  reason: string;
}

model CreateGuardrailDto {
  /** Guardrail Type */
  guardrail_type: string;

  /** Name of the guardrail */
  name: string;

  /** Description of the guardrail */
  description?: string;

  /** Processing stage of the guardrail */
  processing_stage: string;

  /** Parameters for the guardrail */
  params?: {};

  /** Settings for the guardrail */
  settings?: {};

  /** Controls whether violations affect trust score and severity. none = excluded from trust evaluation. */
  trust_impact?: "none" | "low" | "medium" | "high" = "none";

  /** Max triggers in rolling window before penalty applies. null = use system default based on trust_impact. */
  trust_threshold?: {};
}

model UpdateGuardrailDto {
  /** Guardrail Type */
  guardrail_type?: string;

  /** Name of the guardrail */
  name?: string;

  /** Description of the guardrail */
  description?: string;

  /** Processing stage of the guardrail */
  processing_stage?: string;

  /** Active status of the guardrail */
  is_active?: boolean;

  /** Parameters for the guardrail */
  params?: {};

  /** Settings for the guardrail */
  settings?: {};

  /** Controls whether violations affect trust score and severity. none = excluded from trust evaluation. */
  trust_impact?: "none" | "low" | "medium" | "high";

  /** Max triggers in rolling window before penalty applies. null = use system default. */
  trust_threshold?: {};
}

model ReorderGuardrailDto {
  /** New order position (0-based) for the guardrail */
  order: numeric;
}

model CreatePolicyDto {
  /** The name of the policy */
  @maxLength(255) name: string;

  /** A description of what this policy does */
  @maxLength(255) description?: string;

  /** The Rego policy code */
  rego_code: string;

  /** The Rego test input */
  input: {};

  /** Additional configuration for the policy */
  config?: {};

  /** Controls whether violations affect trust score and severity. none = excluded from trust evaluation. */
  trust_impact?: "none" | "low" | "medium" | "high" = "none";

  /** Max triggers in rolling window before penalty applies. null = use system default based on trust_impact. */
  trust_threshold?: {};
}

model UpdatePolicyDto {
  is_active: boolean;

  /** Controls whether violations affect trust score and severity. none = excluded from trust evaluation. */
  trust_impact?: "none" | "low" | "medium" | "high";

  /** Max triggers in rolling window before penalty applies. null = use system default. */
  trust_threshold?: {};
}

model CreateBehaviorRuleDto {
  /** Rule name */
  rule_name: string;

  /** Rule description */
  description?: string;

  /** Priority (1-100, higher = more important) */
  @minValue(1) @maxValue(100) priority: numeric;

  /** Trigger event */
  trigger:
    | "http_get"
    | "http_post"
    | "http_put"
    | "http_patch"
    | "http_delete"
    | "http"
    | "llm_completion"
    | "llm_embedding"
    | "llm_tool_call"
    | "database_select"
    | "database_insert"
    | "database_update"
    | "database_delete"
    | "database_query"
    | "file_read"
    | "file_write"
    | "file_open"
    | "file_delete"
    | "internal";

  /** States (multiple select) */
  states: (
    | "http_get"
    | "http_post"
    | "http_put"
    | "http_patch"
    | "http_delete"
    | "http"
    | "llm_completion"
    | "llm_embedding"
    | "llm_tool_call"
    | "database_select"
    | "database_insert"
    | "database_update"
    | "database_delete"
    | "database_query"
    | "file_read"
    | "file_write"
    | "file_open"
    | "file_delete"
    | "internal")[];

  /** The base_rule_id of the rule that this rule depends on (must be within the same agent) */
  @format("uuid") dependency_base_rule_id?: string;

  /** Time window (in seconds, minimum 1) */
  @minValue(1) time_window: numeric;

  /** Verdict action */
  verdict: 0 | 1 | 2 | 3 | 4;

  /** Reject message */
  reject_message: string;

  /** Approval timeout in seconds - required when verdict is REQUIRE_APPROVAL.
   *  Drives `approval_expiration_time = now + this_value` on every approval
   *  row produced by this rule. This is the only surface in the spec where
   *  the approval window is user-configurable. OPA policies (CreatePolicyDto)
   *  have no equivalent field and always inherit a server-side default
   *  (~30m observed) when their REQUIRE_APPROVAL fires. */
  @minValue(1) approval_timeout?: numeric;

  /** Controls whether violations affect trust score and severity. none = excluded from trust evaluation. */
  trust_impact?: "none" | "low" | "medium" | "high" = "none";

  /** Max triggers in rolling window before penalty applies. null = use system default based on trust_impact. */
  trust_threshold?: {};
}

model ChangeBehaviorRuleStatusDto {
  /** New status */
  is_active: boolean;
}

model UpdateBehavioralRuleDto {
  /** Rule name */
  rule_name: string;

  /** Rule description */
  description?: string;

  /** Priority (1-100, higher = more important) */
  @minValue(1) @maxValue(100) priority: numeric;

  /** Trigger event */
  trigger:
    | "http_get"
    | "http_post"
    | "http_put"
    | "http_patch"
    | "http_delete"
    | "http"
    | "llm_completion"
    | "llm_embedding"
    | "llm_tool_call"
    | "database_select"
    | "database_insert"
    | "database_update"
    | "database_delete"
    | "database_query"
    | "file_read"
    | "file_write"
    | "file_open"
    | "file_delete"
    | "internal";

  /** States (multiple select) */
  states: (
    | "http_get"
    | "http_post"
    | "http_put"
    | "http_patch"
    | "http_delete"
    | "http"
    | "llm_completion"
    | "llm_embedding"
    | "llm_tool_call"
    | "database_select"
    | "database_insert"
    | "database_update"
    | "database_delete"
    | "database_query"
    | "file_read"
    | "file_write"
    | "file_open"
    | "file_delete"
    | "internal")[];

  /** The base_rule_id of the rule that this rule depends on (must be within the same agent) */
  @format("uuid") dependency_base_rule_id?: string;

  /** Time window (in seconds, minimum 1) */
  @minValue(1) time_window: numeric;

  /** Verdict action */
  verdict: 0 | 1 | 2 | 3 | 4;

  /** Reject message */
  reject_message: string;

  /** Approval timeout in seconds - required when verdict is REQUIRE_APPROVAL.
   *  Drives `approval_expiration_time = now + this_value` on every approval
   *  row produced by this rule. This is the only surface in the spec where
   *  the approval window is user-configurable. OPA policies (CreatePolicyDto)
   *  have no equivalent field and always inherit a server-side default
   *  (~30m observed) when their REQUIRE_APPROVAL fires. */
  @minValue(1) approval_timeout?: numeric;

  /** Controls whether violations affect trust score and severity. none = excluded from trust evaluation. */
  trust_impact?: "none" | "low" | "medium" | "high" = "none";

  /** Max triggers in rolling window before penalty applies. null = use system default based on trust_impact. */
  trust_threshold?: {};

  /** Change log */
  change_log: string;
}

model TestGuardrailDto {
  guardrail_type?: string;
  params?: {};
  settings?: {};
  logs?: {};
}

model EvaluateRegoDto {
  /** Rego policy code */
  policy: string;

  /** Input data */
  input: {};
}

model CreateWebhookDto {
  /** Webhook name */
  name: string;

  /** Delivery channel */
  channel: "http" | "slack";

  /** Webhook endpoint URL */
  url: string;

  /** HMAC secret for HTTP channel (auto-generated if omitted) */
  secret?: string;

  /** Event types to subscribe to */
  event_types: string[];

  /** Agent IDs to filter (null/omitted = all agents) */
  agent_ids?: string[];

  /** Description */
  description?: string;
}

model UpdateWebhookDto {
  /** Webhook name */
  name?: string;

  /** Delivery channel */
  channel?: "http" | "slack";

  /** Webhook endpoint URL */
  url?: string;

  /** Event types to subscribe to */
  event_types?: string[];

  /** Agent IDs to filter (empty array = all agents) */
  agent_ids?: string[];

  /** Active status */
  is_active?: boolean;

  /** Description */
  description?: string;
}

model CreateOrganizationDto {
  orgName?: string;
  orgId?: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  address?: string;
  websiteUrl?: string;
  useCase?: string;
  comments?: string;
  description?: string;
}

model UpdateOrganizationSettingsDto {
  /** Organization name */
  name?: string;

  /** Organization domain */
  domain?: string;

  /** Organization timezone */
  timezone?: "America/New_York (EST)" | "America/Los_Angeles (PST)" | "Europe/London (GMT)";
}

model UserRoleDto {
  id: string;
  name: string;
}

model CreateUserDto {
  username: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  password: string;
  roles: UserRoleDto[];
}

model SendWelcomeEmailDto {
  type: "welcome" | "auto_password";
  email: string;
  orgId: string;
  realm: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  password?: string;
}

model InviteUserDto {
  /** Email address of user to invite */
  email: string;

  /** Array of role IDs to assign */
  roles?: string[];
}

model AssignRolesDto {
  /** Array of Role IDs */
  roles: string[];
}

model UpdateMemberDto {
  /** Role ID */
  role: string;

  /** Array of team IDs */
  team_ids: string[];
}

model RemoveMembersDto {
  /** Array of User IDs to remove from organization */
  @minItems(1) @maxItems(100) memberIds: string[];
}

model CreateTeamDto {
  /** Icon URL of agent */
  icon: string;
}

model UpdateTeamDto {}

model DeleteTeamsDto {
  /** Array of team IDs */
  ids: string[];
}

model AddTeamMembersDto {
  /** Array of user IDs */
  user_ids: string[];
}

model DeleteTeamMembersDto {
  /** Array of user IDs */
  user_ids: string[];
}

model PreviewExportDto {
  /** Filter by event types (multiple selection supported) */
  eventTypes?: (
    | "policy_change"
    | "guardrail_change"
    | "agent_session"
    | "agent_risk_configuration_change"
    | "agent_goal_alignment_configuration_change"
    | "role_change"
    | "security_event"
    | "settings_update"
    | "team_management"
    | "member_management"
    | "invitation")[];

  /** Start date for filtering (ISO 8601 format) */
  startDate?: string;

  /** End date for filtering (ISO 8601 format) */
  endDate?: string;
}

model ExportAuditLogsDto {
  /** Name for this export (e.g., "December 2024 Security Events") */
  exportName: string;

  /** Filter by event types (multiple selection supported) */
  eventTypes?: (
    | "policy_change"
    | "guardrail_change"
    | "agent_session"
    | "agent_risk_configuration_change"
    | "agent_goal_alignment_configuration_change"
    | "role_change"
    | "security_event"
    | "settings_update"
    | "team_management"
    | "member_management"
    | "invitation")[];

  /** Filter by actor ID (user ID) */
  actorId?: string;

  /** Filter by result */
  result?: "success" | "failed" | "denied" | "warning" | "approved" | "allowed";

  /** Search in action text */
  search?: string;

  /** Start date for filtering (ISO 8601 format) */
  startDate?: string;

  /** End date for filtering (ISO 8601 format) */
  endDate?: string;
}

model CreateApiKeyDto {
  /** API key name */
  name: string;

  /** Permissions granted to this key */
  permissions: (
    | "write:org"
    | "read:org"
    | "create:user"
    | "read:user"
    | "update:user"
    | "delete:user"
    | "create:agent"
    | "read:agent"
    | "update:agent"
    | "delete:agent"
    | "create:team"
    | "read:team"
    | "update:team"
    | "delete:team"
    | "create:webhook"
    | "read:webhook"
    | "update:webhook"
    | "delete:webhook"
    | "create:api_key"
    | "read:api_key"
    | "update:api_key"
    | "delete:api_key"
    | "manage:sso"
    | "read:agent_session"
    | "manage:agent_session"
    | "read:agent_log"
    | "create:agent_guardrail"
    | "read:agent_guardrail"
    | "update:agent_guardrail"
    | "delete:agent_guardrail"
    | "create:agent_policy"
    | "read:agent_policy"
    | "update:agent_policy"
    | "delete:agent_policy"
    | "create:agent_behavior_rule"
    | "read:agent_behavior_rule"
    | "update:agent_behavior_rule"
    | "delete:agent_behavior_rule")[];

  /** Key is not valid before this timestamp (ISO 8601) */
  valid_from?: string;

  /** Key expires at this timestamp (ISO 8601) */
  expires_at?: string;

  /** Allowed IP addresses or CIDRs */
  ip_whitelist?: string[];

  /** Description */
  description?: string;
}

model UpdateApiKeyDto {
  /** API key name */
  name?: string;

  /** Permissions granted to this key */
  permissions?: (
    | "write:org"
    | "read:org"
    | "create:user"
    | "read:user"
    | "update:user"
    | "delete:user"
    | "create:agent"
    | "read:agent"
    | "update:agent"
    | "delete:agent"
    | "create:team"
    | "read:team"
    | "update:team"
    | "delete:team"
    | "create:webhook"
    | "read:webhook"
    | "update:webhook"
    | "delete:webhook"
    | "create:api_key"
    | "read:api_key"
    | "update:api_key"
    | "delete:api_key"
    | "manage:sso"
    | "read:agent_session"
    | "manage:agent_session"
    | "read:agent_log"
    | "create:agent_guardrail"
    | "read:agent_guardrail"
    | "update:agent_guardrail"
    | "delete:agent_guardrail"
    | "create:agent_policy"
    | "read:agent_policy"
    | "update:agent_policy"
    | "delete:agent_policy"
    | "create:agent_behavior_rule"
    | "read:agent_behavior_rule"
    | "update:agent_behavior_rule"
    | "delete:agent_behavior_rule")[];

  /** Key is not valid before this timestamp (ISO 8601). Set to null to remove. */
  valid_from?: {};

  /** Key expires at this timestamp (ISO 8601). Set to null to remove. */
  expires_at?: {};

  /** Allowed IP addresses or CIDRs. Set to null to allow all IPs. */
  ip_whitelist?: {};

  /** Active status */
  is_active?: boolean;

  /** Description */
  description?: string;
}

model ConfigureSamlDto {}

model ConfigureOidcDto {}

model EnforceSsoDto {}

@tag("Health")
@route("/health")
@get
op AppController_getHello(): OkResponse;

@tag("Auth")
@route("/auth/profile")
@get
op AuthController_getProfile(): Body<UserProfile>;

@tag("Auth")
@route("/auth/csrf")
@get
op AuthController_getCsrf(): NoContentResponse;

@tag("Auth")
@route("/auth/login")
@post
op AuthController_login(@body body: LoginDto): Body<TokenPair>;

@tag("Auth")
@route("/auth/logout")
@post
op AuthController_logout(@body body: LogoutDto): CreatedResponse;

@tag("Auth")
@route("/auth/forgot-password")
@post
op AuthController_forgotPassword(@body body: ForgotPasswordDto): NoContentResponse;

@tag("Auth")
@route("/auth/reset-password")
@post
op AuthController_resetPassword(@body body: ResetPasswordDto): NoContentResponse;

@tag("Auth")
@route("/auth/change-password")
@post
op AuthController_changePassword(@body body: ChangePasswordDto): NoContentResponse;

@tag("Auth")
@route("/auth/refresh")
@post
op AuthController_refreshToken(@body body: RefreshDto): Body<TokenPair>;

@tag("User")
@route("/user/roles")
@get
op UserController_getRoles(): Body<UserRole[]>;

@tag("Agent")
@route("/agent/violations")
@get
op AgentController_getViolations(): Body<Violation[]>;

@tag("Agent")
@route("/agent/metrics")
@get
op AgentController_getAgentsMetrics(): OkResponse;

@tag("Agent")
@route("/agent/list")
@get
op AgentController_getAgents(
  /** Page number (starts from 0) */
  @minValue(0) @query(#{ explode: true }) page?: numeric,

  /** Number of items per page */
  @minValue(1) @query(#{ explode: true }) perPage?: numeric = 10,

  /** Return all agents without pagination. Overrides page and perPage when true. */
  @query(#{ explode: true }) all?: boolean,

  /** Search in agent name and description */
  @query(#{ explode: true }) search?: string,

  @query(#{ explode: true }) status?: numeric,

  /** Team ID */
  @query(#{ explode: true }) team_id?: string,

  /** Tier list */
  @query(#{ explode: true }) tiers?: string[],
): Body<PaginatedResponse<Agent>>;

@tag("Agent")
@route("/agent/aivss")
@post
op AgentController_getAivssScore(@body body: AivssConfigDto): CreatedResponse;

@tag("Agent")
@route("/agent/create")
@post
op AgentController_createAgent(@body body: CreateAgentDto): Body<CreateAgentResponse>;

@tag("Agent")
@route("/agent/{agentId}")
@delete
op AgentController_deleteAgent(@path agentId: string): Body<MessageResponse>;

@tag("Agent")
@route("/agent/{agentId}")
@get
op AgentController_getAgent(@path agentId: string): Body<Agent>;

@tag("Agent")
@route("/agent/{agentId}")
@put
op AgentController_updateAgent(@path agentId: string, @body body: UpdateAgentDto): Body<Agent>;

@tag("Agent")
@route("/agent/{agentId}/violations")
@get
op AgentController_getAgentEvaluations(
  @path agentId: string,
  @body body: GetAgentViolationsDto,
): Body<PaginatedResponse<Violation>>;

@tag("Agent")
@route("/agent/{agentId}/violations/{violationId}/false-positive")
@patch
op AgentController_markAsFalsePositive(
  @path agentId: string,
  @path violationId: string,
  @body body: MarkFalsePositiveDto,
): Body<Violation>;

@tag("Agent")
@route("/agent/{agentId}/logs")
@get
op AgentController_getAgentLogs(
  @path agentId: string,

  /** Page number (starts from 0) */
  @minValue(0) @query(#{ explode: true }) page?: numeric,

  /** Number of items per page */
  @minValue(1) @query(#{ explode: true }) perPage?: numeric = 10,
): Body<PaginatedResponse<unknown>>;

@tag("Agent")
@route("/agent/{agentId}/logs/drift")
@get
op AgentController_getDriftEvents(
  @path agentId: string,

  /** Page number (starts from 0) */
  @minValue(0) @query(#{ explode: true }) page?: numeric,

  /** Number of items per page */
  @minValue(1) @query(#{ explode: true }) perPage?: numeric = 10,
): Body<PaginatedResponse<unknown>>;

@tag("Agent")
@route("/agent/{agentId}/assessments")
@get
op AgentController_getAssessments(
  @path agentId: string,

  /** Page number (starts from 0) */
  @minValue(0) @query(#{ explode: true }) page?: numeric,

  /** Number of items per page */
  @minValue(1) @query(#{ explode: true }) perPage?: numeric = 10,

  /** Filter events starting from this time */
  @query(#{ explode: true }) fromTime?: string,

  /** Filter events ending before this time */
  @query(#{ explode: true }) toTime?: string,
): Body<PaginatedResponse<Assessment>>;

@tag("Agent")
@route("/agent/{agentId}/aivss")
@put
op AgentController_updateAivssConfig(
  @path agentId: string,
  @body body: UpdateAgentAivssConfigDto,
): OkResponse;

@tag("Agent")
@route("/agent/{agentId}/goal-alignment")
@put
op AgentController_updateGoalAlignmentConfig(
  @path agentId: string,
  @body body: GoalAlignmentConfigDto,
): OkResponse;

@tag("Agent")
@route("/agent/{agentId}/aivss/recalculate")
@post
op AgentController_recalculateTrustScore(@path agentId: string): CreatedResponse;

@tag("Agent")
@route("/agent/{agentId}/guardrails")
@get
op AgentController_getGuardrails(
  @path agentId: string,

  /** Page number (starts from 0) */
  @minValue(0) @query(#{ explode: true }) page?: numeric,

  /** Number of items per page */
  @minValue(1) @query(#{ explode: true }) perPage?: numeric = 10,

  /** Processing stage of the guardrail */
  @query(#{ explode: true }) processing_stage?: string,
): Body<PaginatedResponse<Guardrail>>;

@tag("Agent")
@route("/agent/{agentId}/guardrails")
@post
op AgentController_createGuardrail(
  @path agentId: string,
  @body body: CreateGuardrailDto,
): Body<Guardrail>;

@tag("Agent")
@route("/agent/{agentId}/guardrails/metrics")
@get
op AgentController_getGuardrailMetrics(
  @path agentId: string,

  /** Filter events starting from this time */
  @query(#{ explode: true }) fromTime?: string,

  /** Filter events ending before this time */
  @query(#{ explode: true }) toTime?: string,
): OkResponse;

@tag("Agent")
@route("/agent/{agentId}/guardrails/violation-logs")
@get
op AgentController_getGuardrailViolationLogs(
  @path agentId: string,

  /** Page number (starts from 0) */
  @minValue(0) @query(#{ explode: true }) page?: numeric,

  /** Number of items per page */
  @minValue(1) @query(#{ explode: true }) perPage?: numeric = 10,

  /** Filter evaluations created after this time (ISO date string) */
  @query(#{ explode: true }) fromTime?: string,

  /** Filter evaluations created before this time (ISO date string) */
  @query(#{ explode: true }) toTime?: string,

  /** Filter by guardrail type */
  @query(#{ explode: true }) guardrail_type?: string,
): Body<PaginatedResponse<Violation>>;

@tag("Agent")
@route("/agent/{agentId}/guardrails/{guardrailId}")
@delete
op AgentController_deleteGuardrails(@path agentId: string, @path guardrailId: string): Body<MessageResponse>;

@tag("Agent")
@route("/agent/{agentId}/guardrails/{guardrailId}")
@get
op AgentController_getGuardrail(@path agentId: string, @path guardrailId: string): Body<Guardrail>;

@tag("Agent")
@route("/agent/{agentId}/guardrails/{guardrailId}")
@put
op AgentController_updateGuardrails(
  @path agentId: string,
  @path guardrailId: string,
  @body body: UpdateGuardrailDto,
): Body<Guardrail>;

@tag("Agent")
@route("/agent/{agentId}/guardrails/{guardrailId}/reorder")
@patch
op AgentController_reorderGuardrail(
  @path agentId: string,
  @path guardrailId: string,
  @body body: ReorderGuardrailDto,
): Body<Guardrail>;

@tag("Agent")
@route("/agent/{agentId}/policies")
@get
op AgentController_getPolicies(
  @path agentId: string,

  /** Page number (starts from 0) */
  @minValue(0) @query(#{ explode: true }) page?: numeric,

  /** Number of items per page */
  @minValue(1) @query(#{ explode: true }) perPage?: numeric = 10,
): Body<PaginatedResponse<Policy>>;

@tag("Agent")
@route("/agent/{agentId}/policies")
@post
op AgentController_createPolicy(
  @path agentId: string,
  @body body: CreatePolicyDto,
): Body<Policy>;

@tag("Agent")
@route("/agent/{agentId}/policies/metrics")
@get
op AgentController_getPolicesMetrics(
  @path agentId: string,

  /** Filter events starting from this time */
  @query(#{ explode: true }) fromTime?: string,

  /** Filter events ending before this time */
  @query(#{ explode: true }) toTime?: string,
): OkResponse;

@tag("Agent")
@route("/agent/{agentId}/policies/current")
@get
op AgentController_getCurrentPolicy(@path agentId: string): Body<Policy[]>;

@tag("Agent")
@route("/agent/{agentId}/policies/{policyId}")
@get
op AgentController_getPolicy(@path agentId: string, @path policyId: string): Body<Policy>;

@tag("Agent")
@route("/agent/{agentId}/policies/{policyId}")
@put
op AgentController_updatePolicy(
  @path agentId: string,
  @path policyId: string,
  @body body: UpdatePolicyDto,
): Body<Policy>;

@tag("Agent")
@route("/agent/{agentId}/policies/{policyId}/evaluations")
@get
op AgentController_getPolicyEvaluations(
  @path agentId: string,
  @path policyId: string,

  /** Page number (starts from 0) */
  @minValue(0) @query(#{ explode: true }) page?: numeric,

  /** Number of items per page */
  @minValue(1) @query(#{ explode: true }) perPage?: numeric = 10,
): Body<PaginatedResponse<unknown>>;

@tag("Agent")
@route("/agent/{agentId}/sessions")
@get
op AgentController_getSessions(
  @path agentId: string,

  /** Page number (starts from 0) */
  @minValue(0) @query(#{ explode: true }) page?: numeric,

  /** Number of items per page */
  @minValue(1) @query(#{ explode: true }) perPage?: numeric = 10,

  /** Filter by session status */
  @query(#{ explode: true }) status?: "pending" | "completed" | "failed" | "blocked" | "halted",

  /** Filter sessions starting from this time */
  @query(#{ explode: true }) fromTime?: string,

  /** Filter sessions ending before this time */
  @query(#{ explode: true }) toTime?: string,

  /** Filter by duration range */
  @query(#{ explode: true }) duration?: "<1min" | "1-5mins" | "5-15mins" | ">15mins",

  /** Search by workflow_id or run_id */
  @query(#{ explode: true }) search?: string,
): Body<PaginatedResponse<Session>>;

@tag("Agent")
@route("/agent/{agentId}/active-sessions")
@get
op AgentController_getActiveSessions(@path agentId: string): Body<Session[]>;

@tag("Agent")
@route("/agent/{agentId}/sessions/{sessionId}")
@get
op AgentController_getSession(@path agentId: string, @path sessionId: string): Body<Session>;

@tag("Agent")
@route("/agent/{agentId}/sessions/{sessionId}/logs")
@get
op AgentController_getSessionLogs(
  @path agentId: string,
  @path sessionId: string,

  /** Page number (starts from 0) */
  @minValue(0) @query(#{ explode: true }) page?: numeric,

  /** Number of items per page */
  @minValue(1) @query(#{ explode: true }) perPage?: numeric = 10,

  /** Event type */
  @query(#{ explode: true }) event_type?: string,
): Body<PaginatedResponse<unknown>>;

@tag("Agent")
@route("/agent/{agentId}/sessions/{sessionId}/goal-alignment-stats")
@get
op AgentController_getSessionGoalAlignmentStats(
  @path agentId: string,
  @path sessionId: string,
): OkResponse;

@tag("Agent")
@route("/agent/{agentId}/sessions/{sessionId}/reasoning-trace")
@get
op AgentController_getSessionReasoningTrace(
  @path agentId: string,
  @path sessionId: string,
): OkResponse;

@tag("Agent")
@route("/agent/{agentId}/sessions/{sessionId}/terminate")
@patch
op AgentController_terminateSession(@path agentId: string, @path sessionId: string): Body<MessageResponse>;

@tag("Agent")
@route("/agent/{agentId}/goal-alignment/trend")
@get
op AgentController_getGoalAlignmentTrend(
  @path agentId: string,

  /** Filter events starting from this time */
  @query(#{ explode: true }) fromTime?: string,

  /** Filter events ending before this time */
  @query(#{ explode: true }) toTime?: string,
): OkResponse;

@tag("Agent")
@route("/agent/{agentId}/goal-alignment/recent-drifts")
@get
op AgentController_getRecentDriftEvents(
  @path agentId: string,
  @query(#{ explode: true }) limit: numeric,
): OkResponse;

@tag("Agent")
@route("/agent/{agentId}/rotate-api-key")
@post
op AgentController_rotateApiKey(@path agentId: string): Body<ApiKeyResponse>;

@tag("Agent")
@route("/agent/{agentId}/revoke-api-key")
@post
op AgentController_revokeApiKey(@path agentId: string): Body<MessageResponse>;

@tag("Agent")
@route("/agent/{agentId}/observability")
@get
op AgentController_getObservability(
  @path agentId: string,

  /** Start time (ISO format). Default: 24 hours ago */
  @query(#{ explode: true }) fromTime?: string,

  /** End time (ISO format). Default: now */
  @query(#{ explode: true }) toTime?: string,
): OkResponse;

@tag("Agent")
@route("/agent/{agentId}/issues")
@get
op AgentController_getIssues(
  @path agentId: string,

  /** Page number (starts from 0) */
  @minValue(0) @query(#{ explode: true }) page?: numeric,

  /** Number of items per page */
  @minValue(1) @query(#{ explode: true }) perPage?: numeric = 10,
): Body<PaginatedResponse<unknown>>;

@tag("Agent")
@route("/agent/behavior-rule/semantic-types")
@get
op AgentController_getSemanticTypes(): OkResponse;

@tag("Agent")
@route("/agent/{agentId}/behavior-rule")
@get
op AgentController_getBehaviorRuleList(
  @path agentId: string,

  /** Page number (starts from 0) */
  @minValue(0) @query(#{ explode: true }) page?: numeric,

  /** Number of items per page */
  @minValue(1) @query(#{ explode: true }) perPage?: numeric = 10,

  /** Filter by verdict */
  @query(#{ explode: true }) verdict?: 0 | 1 | 2 | 3 | 4,

  /** Filter by status */
  @query(#{ explode: true }) is_active?: boolean,

  /** Filter by trigger */
  @query(#{ explode: true }) trigger?:
    | "http_get"
    | "http_post"
    | "http_put"
    | "http_patch"
    | "http_delete"
    | "http"
    | "llm_completion"
    | "llm_embedding"
    | "llm_tool_call"
    | "database_select"
    | "database_insert"
    | "database_update"
    | "database_delete"
    | "database_query"
    | "file_read"
    | "file_write"
    | "file_open"
    | "file_delete"
    | "internal",
): Body<PaginatedResponse<BehaviorRule>>;

@tag("Agent")
@route("/agent/{agentId}/behavior-rule")
@post
op AgentController_createBehaviorRule(
  @path agentId: string,
  @body body: CreateBehaviorRuleDto,
): Body<BehaviorRule>;

@tag("Agent")
@route("/agent/{agentId}/behavior-rule/current")
@get
op AgentController_getCurrentBehaviorRule(@path agentId: string): Body<BehaviorRule[]>;

@tag("Agent")
@route("/agent/{agentId}/behavior-rule/{behaviorRuleId}")
@delete
op AgentController_deleteBehaviorRule(
  @path agentId: string,
  @path behaviorRuleId: string,
): Body<MessageResponse>;

@tag("Agent")
@route("/agent/{agentId}/behavior-rule/{behaviorRuleId}")
@get
op AgentController_getBehaviorRule(@path agentId: string, @path behaviorRuleId: string): Body<BehaviorRule>;

@tag("Agent")
@route("/agent/{agentId}/behavior-rule/{behaviorRuleId}")
@post
op AgentController_rollbackBehaviorRule(
  @path agentId: string,
  @path behaviorRuleId: string,
): Body<BehaviorRule>;

@tag("Agent")
@route("/agent/{agentId}/behavior-rule/{behaviorRuleId}")
@put
op AgentController_updateBehaviorRule(
  @path agentId: string,
  @path behaviorRuleId: string,
  @body body: UpdateBehavioralRuleDto,
): Body<BehaviorRule>;

@tag("Agent")
@route("/agent/{agentId}/behavior-rule/{behaviorRuleId}/status")
@put
op AgentController_changeBehaviorRuleStatus(
  @path agentId: string,
  @path behaviorRuleId: string,
  @body body: ChangeBehaviorRuleStatusDto,
): Body<BehaviorRule>;

@tag("Agent")
@route("/agent/{agentId}/behavior-rule/{behaviorGroupdId}/versions")
@get
op AgentController_getBehavioralRuleHistories(
  @path agentId: string,
  @path behaviorGroupdId: string,

  /** Page number (starts from 0) */
  @minValue(0) @query(#{ explode: true }) page?: numeric,

  /** Number of items per page */
  @minValue(1) @query(#{ explode: true }) perPage?: numeric = 10,
): Body<PaginatedResponse<BehaviorRule>>;

@tag("Agent")
@route("/agent/{agentId}/behavior/metrics")
@get
op AgentController_getBehaviorMetrics(
  @path agentId: string,

  /** Filter events starting from this time */
  @query(#{ explode: true }) fromTime?: string,

  /** Filter events ending before this time */
  @query(#{ explode: true }) toTime?: string,
): OkResponse;

@tag("Agent")
@route("/agent/{agentId}/trust/histories")
@get
op AgentController_getAgentTrustHistories(
  @path agentId: string,

  /** Time duration for history */
  @query(#{ explode: true }) duration: "7d" | "30d" | "90d" | "1y" = "7d",
): Body<TrustHistory[]>;

@tag("Agent")
@route("/agent/{agentId}/trust/events")
@get
op AgentController_getAgentTrustScoreEvents(
  @path agentId: string,

  /** Page number (starts from 0) */
  @minValue(0) @query(#{ explode: true }) page?: numeric,

  /** Number of items per page */
  @minValue(1) @query(#{ explode: true }) perPage?: numeric = 10,

  /** Filter events starting from this time */
  @query(#{ explode: true }) fromTime?: string,

  /** Filter events ending before this time */
  @query(#{ explode: true }) toTime?: string,
): Body<PaginatedResponse<TrustEvent>>;

@tag("Agent")
@route("/agent/{agentId}/trust/recovery-status")
@get
op AgentController_getAgentTrustRecoveryStatus(@path agentId: string): OkResponse;

@tag("Agent")
@route("/agent/{agentId}/approvals/metrics")
@get
op AgentController_getAgentApprovalsMetrics(
  @path agentId: string,

  /** Filter events starting from this time */
  @query(#{ explode: true }) fromTime?: string,

  /** Filter events ending before this time */
  @query(#{ explode: true }) toTime?: string,
): OkResponse;

@tag("Agent")
@route("/agent/{agentId}/approvals/pending")
@get
op AgentController_getPendingApprovals(
  @path agentId: string,

  /** Page number (starts from 0) */
  @minValue(0) @query(#{ explode: true }) page?: numeric,

  /** Number of items per page */
  @minValue(1) @query(#{ explode: true }) perPage?: numeric = 10,

  @query(#{ explode: true }) search?: string,

  /** Filter by status */
  @query(#{ explode: true }) status?: "pending" | "approved" | "rejected" | "expired",

  /** Tier list */
  @query(#{ explode: true }) tiers?: string[],

  /** Team ID */
  @query(#{ explode: true }) agent_id?: string,

  /** Start time (ISO format) */
  @query(#{ explode: true }) fromTime?: string,

  /** End time (ISO format) */
  @query(#{ explode: true }) toTime?: string,
): Body<PaginatedResponse<Approval>>;

@tag("Agent")
@route("/agent/{agentId}/approvals/history")
@get
op AgentController_getApprovalHistory(
  @path agentId: string,

  /** Page number (starts from 0) */
  @minValue(0) @query(#{ explode: true }) page?: numeric,

  /** Number of items per page */
  @minValue(1) @query(#{ explode: true }) perPage?: numeric = 10,

  @query(#{ explode: true }) search?: string,

  /** Filter by status */
  @query(#{ explode: true }) status?: "pending" | "approved" | "rejected" | "expired",

  /** Tier list */
  @query(#{ explode: true }) tiers?: string[],

  /** Team ID */
  @query(#{ explode: true }) agent_id?: string,

  /** Start time (ISO format) */
  @query(#{ explode: true }) fromTime?: string,

  /** End time (ISO format) */
  @query(#{ explode: true }) toTime?: string,
): Body<PaginatedResponse<Approval>>;

@tag("Agent")
@route("/agent/{agentId}/approvals/{eventId}/decide")
@put
op AgentController_decideApproval(
  @path agentId: string,
  @path eventId: string,

  /** Approve/reject request */
  @query(#{ explode: true }) action: "approve" | "reject",
): Body<Approval>;

@tag("Agent")
@route("/agent/{agentId}/insights/metrics")
@get
op AgentController_getInsightMetrics(
  @path agentId: string,

  /** Filter events starting from this time */
  @query(#{ explode: true }) fromTime?: string,

  /** Filter events ending before this time */
  @query(#{ explode: true }) toTime?: string,
): OkResponse;

@tag("Agent")
@route("/agent/{agentId}/behavior/violations")
@get
op AgentController_getBehaviorViolations(
  @path agentId: string,

  /** Page number (starts from 0) */
  @minValue(0) @query(#{ explode: true }) page?: numeric,

  /** Number of items per page */
  @minValue(1) @query(#{ explode: true }) perPage?: numeric = 10,
): Body<PaginatedResponse<Violation>>;

@tag("Agent")
@route("/agent/{agentId}/trust-tier-changes")
@get
op AgentController_getTrustTierChanges(
  @path agentId: string,

  /** Page number (starts from 0) */
  @minValue(0) @query(#{ explode: true }) page?: numeric,

  /** Number of items per page */
  @minValue(1) @query(#{ explode: true }) perPage?: numeric = 10,

  /** Filter histories starting from this time */
  @query(#{ explode: true }) fromTime?: string,

  /** Filter histories ending before this time */
  @query(#{ explode: true }) toTime?: string,
): Body<PaginatedResponse<TrustTierChange>>;

@tag("Guardrail")
@route("/guardrails/run-test")
@post
op GuardrailController_runTest(@body body: TestGuardrailDto): CreatedResponse;

@tag("Policy")
@route("/policy/evaluate")
@post
op PolicyController_evaluate(@body body: EvaluateRegoDto): CreatedResponse;

@tag("Webhook")
@route("/webhook")
@get
op WebhookController_list(
  /** Page number (starts from 0) */
  @minValue(0) @query(#{ explode: true }) page?: numeric,

  /** Number of items per page */
  @minValue(1) @query(#{ explode: true }) perPage?: numeric = 10,
): Body<PaginatedResponse<Webhook>>;

@tag("Webhook")
@route("/webhook")
@post
op WebhookController_create(@body body: CreateWebhookDto): Body<Webhook>;

@tag("Webhook")
@route("/webhook/{id}")
@delete
op WebhookController_delete(@path id: string): Body<MessageResponse>;

@tag("Webhook")
@route("/webhook/{id}")
@get
op WebhookController_get(@path id: string): Body<Webhook>;

@tag("Webhook")
@route("/webhook/{id}")
@patch
op WebhookController_update(@path id: string, @body body: UpdateWebhookDto): Body<Webhook>;

@tag("Webhook")
@route("/webhook/{id}/deliveries")
@get
op WebhookController_getDeliveryLogs(
  @path id: string,

  /** Page number (starts from 0) */
  @minValue(0) @query(#{ explode: true }) page?: numeric,

  /** Number of items per page */
  @minValue(1) @query(#{ explode: true }) perPage?: numeric = 10,
): Body<PaginatedResponse<WebhookDelivery>>;

@tag("Webhook")
@route("/webhook/{id}/test")
@post
op WebhookController_test(@path id: string): Body<MessageResponse>;

@tag("Webhook")
@route("/webhook/{id}/regenerate-secret")
@post
op WebhookController_regenerateSecret(@path id: string): Body<MessageResponse>;

@tag("Organization")
@route("/organization/register")
@post
op OrganizationController_createOrganization(@body body: CreateOrganizationDto): CreatedResponse;

@tag("Organization")
@route("/organization/demo-setup-status")
@get
op OrganizationController_getDemoSetupStatus(): OkResponse;

@tag("Organization")
@route("/organization/{organizationId}/settings")
@get
op OrganizationController_getOrgSetting(@path organizationId: string): Body<OrgSettings>;

@tag("Organization")
@route("/organization/{organizationId}/settings")
@put
op OrganizationController_updateOrgSetting(
  @path organizationId: string,
  @body body: UpdateOrganizationSettingsDto,
): Body<OrgSettings>;

@tag("Organization")
@route("/organization/{organizationId}/features")
@get
op OrganizationController_getFeatures(@path organizationId: string): Body<OrgFeatures>;

@tag("Organization")
@route("/organization/{organizationId}/members")
@delete
op OrganizationController_removeMembers(
  @path organizationId: string,
  @body body: RemoveMembersDto,
): Body<MessageResponse>;

@tag("Organization")
@route("/organization/{organizationId}/members")
@get
op OrganizationController_getMembers(
  @path organizationId: string,

  /** Page number (starts from 0) */
  @minValue(0) @query(#{ explode: true }) page?: numeric,

  /** Number of items per page */
  @minValue(1) @query(#{ explode: true }) perPage?: numeric = 10,
): Body<PaginatedResponse<Member>>;

@tag("Organization")
@route("/organization/{organizationId}/users")
@post
op OrganizationController_createUser(
  @path organizationId: string,
  @body body: CreateUserDto,
): Body<Member>;

@tag("Organization")
@route("/organization/{organizationId}/send-welcome-email")
@post
op OrganizationController_sendWelcomeEmail(
  @path organizationId: string,
  @body body: SendWelcomeEmailDto,
): CreatedResponse;

@tag("Organization")
@route("/organization/{organizationId}/invitations")
@post
op OrganizationController_inviteUser(
  @path organizationId: string,
  @body body: InviteUserDto,
): Body<MessageResponse>;

@tag("Organization")
@route("/organization/{organizationId}/members/{userId}/roles")
@delete
op OrganizationController_removeRoles(
  @path organizationId: string,
  @path userId: string,
  @body body: AssignRolesDto,
): Body<MessageResponse>;

@tag("Organization")
@route("/organization/{organizationId}/members/{userId}/roles")
@post
op OrganizationController_assignRoles(
  @path organizationId: string,
  @path userId: string,
  @body body: AssignRolesDto,
): Body<MessageResponse>;

@tag("Organization")
@route("/organization/{organizationId}/members/{userId}")
@put
op OrganizationController_updateMember(
  @path organizationId: string,
  @path userId: string,
  @body body: UpdateMemberDto,
): Body<Member>;

@tag("Organization")
@route("/organization/{organizationId}/teams")
@delete
op OrganizationController_deleteTeams(
  @path organizationId: string,
  @body body: DeleteTeamsDto,
): OkResponse;

@tag("Organization")
@route("/organization/{organizationId}/teams")
@get
op OrganizationController_getTeams(
  @path organizationId: string,

  /** Page number (starts from 0) */
  @minValue(0) @query(#{ explode: true }) page?: numeric,

  /** Number of items per page */
  @minValue(1) @query(#{ explode: true }) perPage?: numeric = 10,
): Body<PaginatedResponse<Team>>;

@tag("Organization")
@route("/organization/{organizationId}/teams")
@post
op OrganizationController_createTeam(
  @path organizationId: string,
  @body body: CreateTeamDto,
): Body<Team>;

@tag("Organization")
@route("/organization/{organizationId}/teams/stats")
@get
op OrganizationController_getTeamStats(@path organizationId: string): OkResponse;

@tag("Organization")
@route("/organization/{organizationId}/teams/{teamId}")
@get
op OrganizationController_getTeam(@path organizationId: string, @path teamId: string): Body<Team>;

@tag("Organization")
@route("/organization/{organizationId}/teams/{teamId}")
@put
op OrganizationController_updateTeam(
  @path organizationId: string,
  @path teamId: string,
  @body body: UpdateTeamDto,
): Body<Team>;

@tag("Organization")
@route("/organization/{organizationId}/teams/{teamId}/members")
@delete
op OrganizationController_removeTeamMembers(
  @path organizationId: string,
  @path teamId: string,
  @body body: DeleteTeamMembersDto,
): OkResponse;

@tag("Organization")
@route("/organization/{organizationId}/teams/{teamId}/members")
@get
op OrganizationController_getTeamMembers(
  @path organizationId: string,
  @path teamId: string,

  /** Page number (starts from 0) */
  @minValue(0) @query(#{ explode: true }) page?: numeric,

  /** Number of items per page */
  @minValue(1) @query(#{ explode: true }) perPage?: numeric = 10,
): Body<PaginatedResponse<Member>>;

@tag("Organization")
@route("/organization/{organizationId}/teams/{teamId}/members")
@post
op OrganizationController_addMembers(
  @path organizationId: string,
  @path teamId: string,
  @body body: AddTeamMembersDto,
): CreatedResponse;

@tag("Organization")
@route("/organization/audit-logs")
@get
op OrganizationController_getAuditLogs(
  /** Page number (starts from 0) */
  @minValue(0) @query(#{ explode: true }) page?: numeric,

  /** Number of items per page */
  @minValue(1) @query(#{ explode: true }) perPage?: numeric = 10,

  /** Filter by event type */
  @query(#{ explode: true }) eventType?:
    | "policy_change"
    | "guardrail_change"
    | "agent_session"
    | "agent_risk_configuration_change"
    | "agent_goal_alignment_configuration_change"
    | "role_change"
    | "security_event"
    | "settings_update"
    | "team_management"
    | "member_management"
    | "invitation",

  /** Filter by actor ID (user ID) */
  @query(#{ explode: true }) actorId?: string,

  /** Filter by result */
  @query(#{ explode: true }) result?:
    | "success"
    | "failed"
    | "denied"
    | "warning"
    | "approved"
    | "allowed",

  /** Search in action text */
  @query(#{ explode: true }) search?: string,

  /** Start date for filtering (ISO 8601 format) */
  @query(#{ explode: true }) startDate?: string,

  /** End date for filtering (ISO 8601 format) */
  @query(#{ explode: true }) endDate?: string,
): Body<PaginatedResponse<AuditLog>>;

@tag("Organization")
@route("/organization/audit-logs/export/preview")
@post
op OrganizationController_previewExport(@body body: PreviewExportDto): CreatedResponse;

@tag("Organization")
@route("/organization/audit-logs/export")
@post
op OrganizationController_exportAuditLogs(
  /** Optional filters for audit log export. Leave empty to export all logs. */
  @body body: ExportAuditLogsDto,
): Body<AuditExport>;

@tag("Organization")
@route("/organization/audit-logs/exports")
@get
op OrganizationController_getExportHistory(
  /** Page number (starts from 0) */
  @minValue(0) @query(#{ explode: true }) page?: numeric,

  /** Number of items per page */
  @minValue(1) @query(#{ explode: true }) perPage?: numeric = 10,

  /** Filter by export status */
  @query(#{ explode: true }) status?: "pending" | "processing" | "completed" | "failed",

  /** Start date for filtering (ISO 8601 format) */
  @query(#{ explode: true }) startDate?: string,

  /** End date for filtering (ISO 8601 format) */
  @query(#{ explode: true }) endDate?: string,
): Body<PaginatedResponse<AuditExport>>;

@tag("Organization")
@route("/organization/audit-logs/export/{exportId}")
@delete
op OrganizationController_deleteExport(@path exportId: string): Body<MessageResponse>;

@tag("Organization")
@route("/organization/audit-logs/export/{exportId}")
@get
op OrganizationController_getExportStatus(@path exportId: string): Body<AuditExport>;

@tag("Organization")
@route("/organization/audit-logs/export/{exportId}/download")
@get
op OrganizationController_downloadExport(@path exportId: string): OkResponse;

@tag("Organization")
@route("/organization/audit-logs/{logId}")
@get
op OrganizationController_getAuditLogById(@path logId: string): Body<AuditLog>;

@tag("Organization")
@route("/organization/{organizationId}/dashboard")
@get
op OrganizationController_getObservability(
  @path organizationId: string,

  /** Start time (ISO format). Default: 24 hours ago */
  @query(#{ explode: true }) fromTime?: string,

  /** End time (ISO format). Default: now */
  @query(#{ explode: true }) toTime?: string,
): OkResponse;

@tag("Organization")
@route("/organization/{organizationId}/approvals/metrics")
@get
op OrganizationController_getApprovalsMetrics(
  @path organizationId: string,

  /** Filter events starting from this time */
  @query(#{ explode: true }) fromTime?: string,

  /** Filter events ending before this time */
  @query(#{ explode: true }) toTime?: string,
): OkResponse;

@tag("Organization")
@route("/organization/{organizationId}/approvals/sla")
@get
op OrganizationController_getSlaPerformance(@path organizationId: string): OkResponse;

@tag("Organization")
@route("/organization/{organizationId}/approvals")
@get
op OrganizationController_getApprovals(
  @path organizationId: string,

  /** Page number (starts from 0) */
  @minValue(0) @query(#{ explode: true }) page?: numeric,

  /** Number of items per page */
  @minValue(1) @query(#{ explode: true }) perPage?: numeric = 10,

  @query(#{ explode: true }) search?: string,

  /** Filter by status */
  @query(#{ explode: true }) status?: "pending" | "approved" | "rejected" | "expired",

  /** Tier list */
  @query(#{ explode: true }) tiers?: string[],

  /** Team ID */
  @query(#{ explode: true }) agent_id?: string,

  /** Start time (ISO format) */
  @query(#{ explode: true }) fromTime?: string,

  /** End time (ISO format) */
  @query(#{ explode: true }) toTime?: string,
): Body<OrgApprovalsResponse>;

@tag("Organization")
@route("/organization/{organizationId}/approvals/history")
@get
op OrganizationController_getRecentDecisions(
  @path organizationId: string,

  /** Page number (starts from 0) */
  @minValue(0) @query(#{ explode: true }) page?: numeric,

  /** Number of items per page */
  @minValue(1) @query(#{ explode: true }) perPage?: numeric = 10,
): Body<PaginatedResponse<Approval>>;

@tag("Organization")
@route("/organization/{organizationId}/dashboard/tier-trends")
@get
op OrganizationController_getTrustTierTrends(@path organizationId: string): OkResponse;

@tag("Organization")
@route("/organization/{organizationId}/dashboard/governance-feed")
@get
op OrganizationController_getGovernanceFeed(
  @path organizationId: string,

  /** Page size for the feed (default 20). */
  @query(#{ explode: true }) limit?: numeric,
): OkResponse;

@tag("Organization")
@route("/organization/{organizationId}/dashboard/trust-drift-lanes")
@get
op OrganizationController_getTrustDriftLanes(
  @path organizationId: string,

  /** Number of agent lanes to return (default 8). */
  @query(#{ explode: true }) limit?: numeric,
): OkResponse;

@tag("Organization")
@route("/organization/{organizationId}/dashboard/governance-slo")
@get
op OrganizationController_getGovernanceSlo(
  @path organizationId: string,

  /** Aggregation window: "7d" / "30d" / "90d" (default "30d"). */
  @query(#{ explode: true }) window?: string,
): OkResponse;

@tag("Organization")
@route("/organization/{organizationId}/dashboard/violation-heatcal")
@get
op OrganizationController_getViolationHeatcal(
  @path organizationId: string,

  /** Aggregation window: "7d" / "30d" / "90d" (default "30d"). */
  @query(#{ explode: true }) window?: string,
): OkResponse;

@tag("Organization")
@route("/organization/{organizationId}/sessions")
@get
op OrganizationController_getSessions(
  @path organizationId: string,

  /** Page number (starts from 0) */
  @minValue(0) @query(#{ explode: true }) page?: numeric,

  /** Number of items per page */
  @minValue(1) @query(#{ explode: true }) perPage?: numeric = 10,

  /** Filter by session status */
  @query(#{ explode: true }) status?: "pending" | "completed" | "failed" | "blocked" | "halted",

  /** Filter sessions starting from this time */
  @query(#{ explode: true }) fromTime?: string,

  /** Filter sessions ending before this time */
  @query(#{ explode: true }) toTime?: string,

  /** Filter by duration range */
  @query(#{ explode: true }) duration?: "<1min" | "1-5mins" | "5-15mins" | ">15mins",

  /** Search by workflow_id or run_id */
  @query(#{ explode: true }) search?: string,
): Body<PaginatedResponse<Session>>;

@tag("Organization")
@route("/organization/{organizationId}")
@get
op OrganizationController_getOrganization(@path organizationId: string): Body<Organization>;

@tag("API Keys")
@route("/api-key")
@get
op ApiKeyController_list(
  /** Page number (starts from 0) */
  @minValue(0) @query(#{ explode: true }) page?: numeric,

  /** Number of items per page */
  @minValue(1) @query(#{ explode: true }) perPage?: numeric = 10,
): Body<PaginatedResponse<ApiKey>>;

@tag("API Keys")
@route("/api-key")
@post
op ApiKeyController_create(@body body: CreateApiKeyDto): Body<ApiKey>;

@tag("API Keys")
@route("/api-key/{id}")
@delete
op ApiKeyController_delete(@path id: string): Body<MessageResponse>;

@tag("API Keys")
@route("/api-key/{id}")
@get
op ApiKeyController_get(@path id: string): Body<ApiKey>;

@tag("API Keys")
@route("/api-key/{id}")
@patch
op ApiKeyController_update(@path id: string, @body body: UpdateApiKeyDto): Body<ApiKey>;

@tag("SSO")
@route("/sso")
@delete
op SsoController_removeConfig(): Body<MessageResponse>;

@tag("SSO")
@route("/sso")
@get
op SsoController_getConfig(): OkResponse;

@tag("SSO")
@route("/sso/saml")
@post
op SsoController_configureSaml(@body body: ConfigureSamlDto): Body<MessageResponse>;

@tag("SSO")
@route("/sso/oidc")
@post
op SsoController_configureOidc(@body body: ConfigureOidcDto): Body<MessageResponse>;

@tag("SSO")
@route("/sso/enforce")
@put
op SsoController_setEnforcement(@body body: EnforceSsoDto): Body<MessageResponse>;

@tag("SSO")
@route("/sso/metadata")
@get
op SsoController_getSpMetadata(): OkResponse;

@tag("SSO")
@route("/sso/verify")
@post
op SsoController_verifyConfiguration(): Body<MessageResponse>;

@tag("SSO")
@route("/sso/status")
@get
op SsoController_getPublicStatus(@query(#{ explode: true }) orgId: string): Body<SsoStatus>;
