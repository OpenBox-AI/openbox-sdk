// Derived from the-core-service Go structs (internal/content/governance.go)

export type GovernanceEventType =
  | 'WorkflowStarted'
  | 'WorkflowCompleted'
  | 'WorkflowFailed'
  | 'ActivityStarted'
  | 'ActivityCompleted'
  | 'LLMStarted'
  | 'LLMCompleted'
  | 'ToolStarted'
  | 'ToolCompleted'
  | 'SignalReceived';

export type GovernanceVerdict =
  | 'allow'
  | 'constrain'
  | 'require_approval'
  | 'block'
  | 'halt';

export type GovernanceLegacyAction = 'continue' | 'stop' | 'require-approval';

export interface SpanStatus {
  code?: string;
  message?: string;
}

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, unknown>;
}

export interface SpanData {
  span_id: string;
  trace_id: string;
  parent_span_id?: string;
  name: string;
  kind?: string;
  start_time: number;
  end_time: number;
  duration_ns?: number;
  attributes?: Record<string, unknown>;
  status?: SpanStatus;
  events?: SpanEvent[];
  request_headers?: Record<string, string>;
  response_headers?: Record<string, string>;
  request_body?: string;
  response_body?: string;
  semantic_type?: string;
  stage?: 'started' | 'completed';
  http_method?: string;
  http_url?: string;
  http_status_code?: number;
  db_system?: string;
  db_name?: string;
  db_operation?: string;
  db_statement?: string;
  server_address?: string;
  server_port?: number;
  rowcount?: number;
  file_path?: string;
  file_mode?: string;
  file_operation?: string;
  bytes_read?: number;
  bytes_written?: number;
  lines_count?: number;
  function?: string;
  module?: string;
  args?: unknown;
  result?: unknown;
}

export interface ErrorInfo {
  type: string;
  message: string;
  stack_trace?: string;
  cause?: ErrorInfo;
  error_type?: string;
  non_retryable?: boolean;
}

export interface GovernanceEventPayload {
  source: string;
  event_type: GovernanceEventType;
  workflow_id: string;
  run_id: string;
  workflow_type: string;
  task_queue: string;
  timestamp: string;
  parent_workflow_id?: string;
  status?: string;
  activity_id?: string;
  activity_type?: string;
  attempt?: number;
  // MUST be an array. AGE rejects objects with 422: "Input should be a valid list".
  activity_input?: unknown[];
  activity_output?: unknown;
  signal_name?: string;
  signal_args?: unknown;
  start_time?: number;
  end_time?: number;
  duration_ms?: number;
  span_count?: number;
  spans?: SpanData[];
  hook_trigger?: boolean;
  sdk_version?: string;
  error?: ErrorInfo;
}

export interface GuardrailReason {
  type: string;
  message: string;
}

export interface GuardrailVerdictResult {
  guardrail_id: string;
  guardrail_name: string;
  guardrail_type: string;
  passed: boolean;
  reasons?: GuardrailReason[];
}

export interface GuardrailsResult {
  input_type: 'activity_input' | 'activity_output';
  redacted_input: unknown;
  raw_logs: Record<string, unknown>;
  validation_passed: boolean;
  reasons: GuardrailReason[];
  results: GuardrailVerdictResult[];
}

export interface AGETrustScore {
  overall: number;
  risk_profile: number;
  behavioral: number;
  alignment: number;
}

export interface AGESpanResult {
  span_id: string;
  verdict: number;
  reason?: string;
}

export interface AGEResult {
  allowed: boolean;
  verdict: number;
  reason?: string;
  goal_alignment_checked: boolean;
  goal_drifted: boolean;
  fallback_used: boolean;
  final_trust_score?: AGETrustScore;
  span_results: AGESpanResult[];
  total_spans: number;
  violations_count: number;
  response_time_ms: number;
}

export interface GovernanceVerdictResponse {
  governance_event_id: string;
  verdict: GovernanceVerdict;
  risk_score: number;
  action: GovernanceLegacyAction;
  trust_tier?: number;
  behavioral_violations?: string[];
  approval_id?: string;
  constraints?: string[];
  approval_expiration_time?: string;
  fallback_used: boolean;
  reason?: string;
  policy_id?: string;
  metadata?: Record<string, unknown>;
  guardrails_result?: GuardrailsResult;
  age_result?: AGEResult;
}

export interface AgentValidationResponse {
  valid: boolean;
  active: boolean;
  agent_id: string;
  agent_name: string;
  environment: 'live' | 'test';
  message: string;
}

export interface ApprovalStatusRequest {
  workflow_id: string;
  run_id: string;
  activity_id: string;
}
