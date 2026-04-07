// ---------------------------------------------------------------------------
// Generic response wrappers
// ---------------------------------------------------------------------------

export interface PaginatedResponse<T> {
  data: T[];
  meta?: { total: number; page: number; perPage: number };
  total?: number;
}

export interface MessageResponse {
  message: string;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface UserProfile {
  sub: string;
  email: string;
  name?: string;
  preferred_username?: string;
  email_verified?: boolean;
  [key: string]: unknown;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface UserRole {
  id: string;
  name: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export interface Agent {
  id: string;
  agent_name: string;
  agent_type?: string;
  model_name?: string;
  description?: string;
  organization_id: string;
  config?: Record<string, unknown>;
  team_ids?: string[];
  tags?: string[];
  icon?: string;
  trust_score?: number;
  tier?: string;
  status?: number;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface CreateAgentResponse {
  agent: Agent;
  token: string;
}

// ---------------------------------------------------------------------------
// API Key
// ---------------------------------------------------------------------------

export interface ApiKeyResponse {
  token: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Guardrail
// ---------------------------------------------------------------------------

export interface Guardrail {
  id: string;
  name: string;
  guardrail_type: string;
  description?: string;
  processing_stage: string;
  is_active: boolean;
  params?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  trust_impact?: string;
  trust_threshold?: number | null;
  order?: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export interface Policy {
  id: string;
  name: string;
  description?: string;
  rego_code: string;
  input?: Record<string, unknown>;
  is_active: boolean;
  trust_impact?: string;
  trust_threshold?: number | null;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Behavior Rule
// ---------------------------------------------------------------------------

export interface BehaviorRule {
  id: string;
  rule_name: string;
  description?: string;
  priority: number;
  trigger: string;
  states: string[];
  time_window: number;
  verdict: number;
  reject_message: string;
  is_active: boolean;
  group_id?: string;
  version?: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export interface Session {
  id: string;
  session_id?: string;
  agent_id?: string;
  status?: string;
  started_at?: string;
  ended_at?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Trust
// ---------------------------------------------------------------------------

export interface TrustHistory {
  trust_score: number;
  tier?: string;
  timestamp?: string;
  [key: string]: unknown;
}

export interface TrustEvent {
  id: string;
  event_type?: string;
  impact?: number;
  timestamp?: string;
  [key: string]: unknown;
}

export interface TrustTierChange {
  id: string;
  from_tier?: string;
  to_tier?: string;
  reason?: string;
  timestamp?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// AIVSS
// ---------------------------------------------------------------------------

export interface Assessment {
  id: string;
  score?: number;
  severity?: string;
  timestamp?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

export interface Approval {
  id: string;
  event_id?: string;
  agent_id?: string;
  status?: string;
  action_type?: string;
  created_at?: string;
  decided_at?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Violation
// ---------------------------------------------------------------------------

export interface Violation {
  id: string;
  agent_id?: string;
  source_type?: string;
  pattern?: string;
  is_false_positive?: boolean;
  timestamp?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

export interface Organization {
  id: string;
  name: string;
  domain?: string;
  [key: string]: unknown;
}

export interface OrgSettings {
  name?: string;
  domain?: string;
  timezone?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

export interface Team {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Member
// ---------------------------------------------------------------------------

export interface Member {
  id: string;
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Audit Log
// ---------------------------------------------------------------------------

export interface AuditLog {
  id: string;
  event_type?: string;
  actor_id?: string;
  result?: string;
  details?: Record<string, unknown>;
  created_at?: string;
  [key: string]: unknown;
}

export interface AuditExport {
  id: string;
  export_name?: string;
  status?: string;
  created_at?: string;
  [key: string]: unknown;
}
