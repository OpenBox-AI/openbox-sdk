import "@typespec/http";
import "@typespec/openapi";
import "@typespec/openapi3";

using Http;
using OpenAPI;

/**
 * The OpenBox Core governance engine API. This is the service that SDKs call
 * for real-time governance evaluation and approval polling.
 *
 * Base URL: https://core.openbox.ai
 *
 */
@service(#{ title: "OpenBox Core Governance API" })
@info(#{ version: "1.0.0" })
@server("https://core.openbox.ai", "Production")
namespace OpenboxCore;

model CoreError {
  code?: integer;
  message?: string;
}

model GovernanceEventPayload {
  event_type:
    | "WorkflowStarted"
    | "WorkflowCompleted"
    | "ActivityStarted"
    | "ActivityCompleted"
    | "LLMStarted"
    | "LLMCompleted"
    | "ToolStarted"
    | "ToolCompleted"
    | "SignalReceived";
  workflow_id: string;
  workflow_type?: string;
  run_id: string;
  activity_id?: string;
  activity_type?: string;
  @oneOf activity_input?: unknown[] | {};
  activity_output?: unknown;
  source?: string = "workflow-telemetry";
  task_queue?: "langgraph" | "temporal" | "mastra";
  timestamp?: utcDateTime;
  hook_trigger?: boolean;
  goal?: string;
  span_count?: integer;
  spans?: SpanObject[];
  error?: {
    type?: string;
    message?: string;
  };
  duration_ms?: numeric;
  attempt?: integer;
  __openbox?: {
    tool_type?: string;
    subagent_name?: string;
  };
}

model SpanObject {
  name?: string;
  trace_id?: string;
  span_id?: string;
  parent_span_id?: string;
  kind?: string;

  /** Nanoseconds */
  start_time?: integer;

  end_time?: integer;
  duration_ns?: integer;
  attributes?: {
    `http.method`?: string;
    `http.url`?: string;
    `http.status_code`?: integer;
    `db.operation`?: string;
    `db.statement`?: string;
    `file.operation`?: string;
    `file.path`?: string;
  };
  request_headers?: {};
  response_headers?: {};
  request_body?: string;
  response_body?: string;
  status?: {
    code?: string;
    description?: string;
  };
  events?: {}[];
}

model GovernanceVerdictResponse {
  verdict?: "ALLOW" | "CONSTRAIN" | "REQUIRE_APPROVAL" | "BLOCK" | "HALT";
  action?: "allow" | "constrain" | "approval" | "block" | "halt";
  reason?: string;
  policy_id?: string;
  approval_id?: string;
  guardrails_result?: {
    validation_passed?: boolean;
    input_type?: "activity_input" | "activity_output";
    redacted_input?: unknown;
    reasons?: string[];
  };
  age_result?: {
    fallback_used?: boolean;
    goal_alignment_checked?: boolean;
    goal_drifted?: boolean;
  };
}

model ApprovalPollRequest {
  workflow_id: string;
  run_id: string;
  activity_id: string;
}

model ApprovalPollResponse {
  verdict?: "ALLOW" | "BLOCK" | "REQUIRE_APPROVAL" | "HALT";
  action?: string;
  reason?: string;
  approval_expiration_time?: utcDateTime;
  expired?: boolean;
}

@tag("Health")
@route("/")
@get
@summary("Health check")
op healthCheck(): {
  @header contentType: "text/plain";
  @body body: string;
};

@tag("Auth")
@route("/api/v1/auth/validate")
@get
@summary("Validate SDK API key")
op validateApiKey(): OkResponse | (UnauthorizedResponse & CoreError);

/**
 * Core governance endpoint. Receives telemetry events from SDKs and returns
 * a verdict (allow/constrain/require_approval/block/halt).
 *
 * Internally runs: token validation → session check → dedup → OPA policy →
 * guardrails → AGE behavioral compliance → goal alignment → attestation.
 *
 */
@tag("Governance")
@route("/api/v1/governance/evaluate")
@post
@summary("Evaluate governance event")
op evaluateGovernance(
  @body body: GovernanceEventPayload,
): GovernanceVerdictResponse | UnauthorizedResponse | {
  @statusCode statusCode: 408;
};

/**
 * SDK polls this endpoint after receiving a REQUIRE_APPROVAL verdict.
 * Returns the current approval status (pending/approved/rejected/expired).
 *
 */
@tag("Governance")
@route("/api/v1/governance/approval")
@post
@summary("Poll approval status")
op pollApproval(@body body: ApprovalPollRequest): ApprovalPollResponse;
