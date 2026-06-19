import "@typespec/http";
import "@typespec/openapi";
import "@typespec/openapi3";

using Http;
using OpenAPI;

/**
 * Public HTTP surface of `cmd/core`. Two governance endpoints
 * (`/governance/evaluate`, `/governance/approval`), one auth probe
 * (`/auth/validate`), one health check (`/`). All v1 routes mount
 * under `/api/v1`.
 *
 * This document is hand-written and tracks the structs in
 * `internal/content/governance.go` + the handlers in
 * `internal/api/`. Update both when changing the wire format.
 * Verifier is `cmd/core/openapi_test.go` (planned).
 *
 */
@service(#{ title: "OpenBox Core Governance API" })
@info(#{ version: "1.1.0", license: #{ name: "BUSL-1.1" } })
@server("https://core.openbox.ai", "Production")
@server("http://localhost:8080", "Local")
@tagMetadata("Health", #{ description: "Liveness checks." })
@tagMetadata("Auth", #{ description: "SDK API-key validation." })
@tagMetadata(
  "Governance",
  #{ description: "Real-time governance evaluation and approval polling." }
)
namespace OpenboxCore;

model CoreError {
  /** HTTP status echoed in the body. */
  code: integer;

  message: string;
}

/**
 * Five-tier graduated response. Priority order (highest first):
 * `halt` > `block` > `require_approval` > `constrain` > `allow`.
 *
 * Wire format is the lowercase string. The Go server also accepts
 * the integer form (0..4) on input for backward compatibility,
 * but always emits the string. `constrain` is a valid runtime verdict
 * for transformed or redacted data and consumers must handle it as an
 * allowed-but-modified path.
 *
 */
enum Verdict {
  allow,
  constrain,
  require_approval,
  block,
  halt,
}

/**
 * v1.0 action string, kept on responses for backwards compatibility
 * with older SDKs. New code should branch on `verdict`.
 *
 */
enum LegacyAction {
  allow,
  constrain,
  require_approval,
  block,
  halt,
  continue,
  stop,
}

/**
 * Response from `/auth/validate`. `environment` is derived from the
 * token prefix (`obx_live_*` -> `live`, `obx_test_*` -> `test`,
 * anything else -> `unknown`).
 *
 */
model AgentValidationResponse {
  valid: boolean;

  /**
   * False if the agent record exists but is suspended/disabled.
   * (The 401 path handles unknown / malformed tokens; this flag
   * distinguishes a known-but-inactive agent.)
   *
   */
  active: boolean;

  @format("uuid") agent_id: string;
  agent_name: string;
  environment: "live" | "test" | "unknown";
  message: string;
}

/** Discriminator for the unified `GovernanceEventPayload`. */
enum EventType {
  WorkflowStarted,
  WorkflowCompleted,
  WorkflowFailed,
  ActivityStarted,
  ActivityCompleted,
  SignalReceived,
}

/**
 * Unified event payload; all six event types share this shape, and
 * only the fields relevant to that type are populated. The SDK
 * keeps `workflow_id` and `run_id` constant across one workflow
 * run; `activity_id` is per-action and pairs ActivityStarted with
 * ActivityCompleted.
 *
 * The `required` block here lists every field the Go struct
 * always emits / accepts as a non-pointer string. The handler's
 * explicit validation is narrower (`event_type`, `workflow_id`,
 * `run_id` only); clients that cannot fill the others should
 * send empty strings rather than omit the keys.
 *
 */
model GovernanceEventPayload {
  /** Originating system. Conventionally `workflow-telemetry`. */
  source: string;

  event_type: EventType;
  workflow_id: string;
  run_id: string;

  /** Implementation-specific workflow class name. */
  workflow_type: string;

  /** Originating SDK / runtime. */
  task_queue: "langgraph" | "temporal" | "mastra" | "claude-code" | "cursor" | "generic";

  timestamp: utcDateTime;

  /**
   * Server-populated from the `X-OpenBox-SDK-Version` header on
   * ingest. Clients should set the header, not this field;
   * included here because the JSON shape carries it forward.
   *
   */
  sdk_version?: string;

  /** Set on `WorkflowStarted` for child workflows. */
  parent_workflow_id?: string;

  /** Set on `WorkflowCompleted`/`WorkflowFailed`. */
  status?: "completed" | "failed" | "cancelled" | "terminated";

  /** Set on Activity* and SignalReceived events. */
  activity_id?: string;

  /**
   * Canonical activity type. Examples: `PromptSubmission`,
   * `LLMCompleted`, `ToolCompleted`, `FileRead`, `FileEdit`,
   * `ShellExecution`, `MCPToolCall`. See sdk-implementation-guide for
   * the full list.
   *
   */
  activity_type?: string;

  /** Retry counter, set on Activity* events. */
  @minValue(1) attempt?: int32;

  /**
   * Activity input payload. The Go server accepts any JSON value
   * but the SDKs always wrap as an array (`[{...}]`); passing a
   * bare object yields a 422 from the validation layer.
   *
   */
  @oneOf activity_input?: unknown[] | {};

  /** Activity output payload, set on `ActivityCompleted`. */
  activity_output?: unknown;

  /** Caller/runtime session identifier, distinct from Core's internal session UUID. */
  session_id?: string;

  /** LLM model identifier for SDKs that observe usage outside provider HTTP spans. */
  llm_model?: string;

  /** Prompt/input token count observed by the SDK. */
  input_tokens?: int64;

  /** Completion/output token count observed by the SDK. */
  output_tokens?: int64;

  /** Total token count observed by the SDK. */
  total_tokens?: int64;

  /** True when the LLM completion requested tool calls. */
  has_tool_calls?: boolean;

  /** Provider finish reason, when available. */
  finish_reason?: string;

  /** Prompt text for LLM start events, when available. */
  prompt?: string;

  /** Assistant completion text for LLM completion events, when available. */
  completion?: string;

  /** Tool/function name for tool-call activities. */
  tool_name?: string;

  /** Tool/function category such as http, database, builtin, a2a, or custom. */
  tool_type?: string;

  /** Parent runtime run id when emitted by frameworks that expose nested runs. */
  parent_run_id?: string;

  /** Set on `SignalReceived`. */
  signal_name?: string;

  /** Set on `SignalReceived`. */
  signal_args?: unknown;

  /** Activity start time in epoch milliseconds. */
  start_time?: numeric;

  /** Activity end time in epoch milliseconds. */
  end_time?: numeric;

  /** Convenience field; equals `end_time - start_time`. */
  duration_ms?: numeric;

  /** Length of `spans` array. Server validates the count. */
  span_count?: int32;

  spans?: SpanData[];

  /**
   * `true` if this evaluation was triggered mid-activity by an
   * HTTP/DB/file/function hook (claude-code/cursor hooks). Server
   * short-circuits dedup against the most recent span only.
   *
   */
  hook_trigger?: boolean;

  error?: ErrorInfo;
}

/**
 * Single OTel-style span. Root-level fields (`http_method`,
 * `db_operation`, `file_path`, `function`, …) replace the earlier
 * attribute-bag layout; emitters MUST populate the typed fields
 * instead of stuffing them into `attributes`. `semantic_type` is
 * computed by the server (`ComputeSemanticTypeFromSpan`) when the
 * SDK doesn't set it.
 *
 */
model SpanData {
  span_id: string;
  trace_id: string;
  parent_span_id?: string;
  name: string;

  /** OTel SpanKind. Conventionally one of CLIENT, SERVER, INTERNAL, PRODUCER, CONSUMER. */
  kind?: string;

  /** Epoch nanoseconds. */
  start_time: int64;

  /** Epoch nanoseconds. */
  end_time: int64;

  duration_ns?: int64;

  /** Free-form attribute bag for fields not yet promoted to root. */
  attributes?: Record<unknown>;

  status?: SpanStatus;
  events?: SpanEvent[];
  request_headers?: Record<string>;
  response_headers?: Record<string>;
  request_body?: string;
  response_body?: string;

  /**
   * Server-computed bucket. Examples: `http_get`, `llm_completion`,
   * `database_select`, `file_read`, `shell_execution`. SDK can
   * pre-compute and send; server overrides if mismatched.
   *
   */
  semantic_type?: string;

  stage?: "started" | "completed" = "completed";

  /** Free-form payload. Map for attestation; string for file ops. */
  data?: unknown;

  /** SDK v2 hook source. */
  hook_type?: "http_request" | "db_query" | "file_operation" | "function_call";

  /** Per-span dedup keys. */
  attribute_key_identifiers?: string[];

  /** Per-span error string (separate from envelope `error`). */
  error?: string;

  http_method?: string;
  http_url?: string;
  http_status_code?: int32;
  db_system?: string;
  db_name?: string;
  db_operation?: string;
  db_statement?: string;
  server_address?: string;
  server_port?: int32;
  rowcount?: int32;
  file_path?: string;
  file_mode?: string;
  file_operation?: string;
  bytes_read?: int64;
  bytes_written?: int64;
  lines_count?: int32;
  function?: string;
  module?: string;

  /** Function call args. Free-form (object/array/null). */
  args?: unknown;

  /** Function call result. Free-form (any/null). */
  result?: unknown;
}

model SpanStatus {
  code: "OK" | "ERROR" | "UNSET";
  description?: string;
}

model SpanEvent {
  name: string;

  /** Epoch nanoseconds. */
  timestamp: int64;

  attributes: Record<unknown>;
}

model ErrorInfo {
  type: string;
  message: string;
  stack_trace?: string;
  cause?: ErrorInfo;

  /** Application-level error classifier, e.g. Temporal's `ApplicationError` type. */
  error_type?: string;

  non_retryable?: boolean;
}

/**
 * Public verdict envelope returned from `/governance/evaluate`.
 * The wire shape strips internal observability fields like
 * `_governance_event_id`.
 *
 * SDKs should branch on `verdict`. The legacy `action` field
 * carries the v1.0 string and is kept for backward compatibility
 * but tracks `verdict`.
 *
 */
model GovernanceVerdictResponse {
  /** Stable identifier for this evaluation; key for approval polling. */
  @format("uuid") governance_event_id: string;

  verdict: Verdict;

  /** Aggregate risk in [0, 1] across all evaluation branches. */
  @minValue(0) @maxValue(1) risk_score: float64;

  action: LegacyAction;

  /** Agent trust tier at the moment of evaluation. */
  @minValue(1) @maxValue(4) trust_tier?: int32;

  /** Top-level goal-alignment score returned by older Core/AGE response paths. */
  @minValue(0) @maxValue(1) alignment_score?: float64;

  /** Behavior-rule names that triggered. */
  behavioral_violations?: string[];

  /** Set on `require_approval`; opaque ID returned for approval clients. */
  approval_id?: string;

  /** Set on `constrain`; enforcement hints for transformed output. */
  constraints?: string[];

  /** Wall-clock deadline for the approval; SDK stops polling after
   *  this. The value is set by core when the verdict is
   *  REQUIRE_APPROVAL: from `behavior_rule.approval_timeout` if the
   *  trigger was a behavior_rule, or from a server-side default
   *  (~30m observed) if the trigger was an OPA policy. OPA policies
   *  cannot configure the timeout; `CreatePolicyDto` has no
   *  `approval_timeout` field and the Rego return shape carries
   *  only `{decision, reason}`. To control the window, attach a
   *  behavior_rule with `--verdict 2 --approval-timeout <seconds>`. */
  approval_expiration_time?: utcDateTime;

  /** True if any evaluation branch used a fallback path. */
  fallback_used: boolean;

  reason?: string;

  /** Policy that produced the verdict, when applicable. */
  policy_id?: string;

  metadata?: Record<unknown>;
  guardrails_result?: GuardrailsResult;
  age_result?: AGEResult;
}

/** SDK-facing guardrail report; one entry per guardrail type that ran. */
model GuardrailsResult {
  input_type: "activity_input" | "activity_output";

  /**
   * Redacted or transformed payload as decided by the guardrail
   * service. Free-form: string for text content, object for
   * structured payloads such as tool args.
   *
   */
  redacted_input: unknown;

  /** Raw guardrail-service output, retained for debugging. */
  raw_logs?: Record<unknown>;

  /** False when any field result is `blocked`. */
  validation_passed: boolean;

  reasons: GuardrailReason[];
  results: GuardrailsVerdictResult[];
}

model GuardrailReason {
  type: string;
  field: string;
  reason: string;
}

model GuardrailsVerdictResult {
  guardrail_type: string;
  results: GuardrailFieldResult[];
}

model GuardrailFieldResult {
  field: string;
  order: int32;
  status: "allowed" | "blocked" | "redacted" | "skipped";
  reason?: string;
}

/**
 * Output of the agent-governance evaluation: behavioral compliance,
 * alignment scoring, and trust update.
 *
 */
model AGEResult {
  allowed: boolean;
  verdict: Verdict;
  reason?: string;

  /** True if LlamaFirewall ran for this event. */
  goal_alignment_checked: boolean;

  /** True if alignment score crossed the agent's threshold. */
  goal_drifted: boolean;

  fallback_used: boolean;
  final_trust_score?: AGETrustScore;
  span_results: AGESpanResult[];
  total_spans: int32;
  violations_count: int32;
  response_time_ms: int64;
}

model AGETrustScore {
  trust_score: float64;
  @minValue(1) @maxValue(4) trust_tier: int32;
  behavioral_compliance: float64;
  alignment_consistency: float64;
  aivss_baseline: float64;
}

model AGEAlignmentResult {
  is_aligned: boolean;
  score: float64;
}

model AGESpanResult {
  span_id: string;
  semantic_type: string;

  /** Free-form behavioral evaluator output. Null when not evaluated. */
  behavioral_result: unknown;

  alignment_result?: AGEAlignmentResult;
  trust_score_after?: AGETrustScore;
  timestamp: utcDateTime;
}

/**
 * Lookup tuple for `/governance/approval`. The server only
 * validates non-empty strings after authenticating the runtime agent.
 *
 */
model ApprovalStatusRequest {
  workflow_id: string;
  run_id: string;
  activity_id: string;
}

model ApprovalStatusResponse {
  /** Governance event ID. */
  @format("uuid") id: string;

  action: LegacyAction;
  reason?: string;

  /**
   * Absent when the request hasn't entered the approval flow yet
   * or when no expiration was set on the policy.
   *
  */
  approval_expiration_time?: utcDateTime;
}

/** Returns the literal string `hello world`. Used by load balancers and uptime probes. */
@tag("Health")
@route("/")
@get
@summary("Health check")
op healthCheck(): {
  @header contentType: "text/plain";
  @body body: string;
};

/**
 * Verifies the `Authorization: Bearer <obx_live_*|obx_test_*>` header
 * against the agent registry. Returns the resolved agent identity
 * and the `live` vs `test` environment derived from the prefix.
 *
 */
@tag("Auth")
@route("/api/v1/auth/validate")
@get
@summary("Validate the bearer API key")
op validateApiKey(): AgentValidationResponse | (UnauthorizedResponse & CoreError);

/**
 * Receives one event from a governed workflow and returns a verdict.
 * The wire format multiplexes five `event_type` values
 * (WorkflowStarted, WorkflowCompleted, WorkflowFailed,
 * ActivityStarted, ActivityCompleted, SignalReceived) onto a single
 * struct; populate only the fields relevant to the event type.
 *
 * Internally fans out to: token validation -> session check ->
 * dedup -> OPA policy -> guardrails -> AGE behavioral compliance ->
 * goal alignment -> attestation. Verdict is the highest-priority
 * result across all branches. Default workflow timeout is 30s.
 *
 * The SDK MUST propagate the original `WorkflowID` / `RunID` /
 * `ActivityID` across paired Started/Completed events for dedup
 * and approval polling to work.
 *
 */
@tag("Governance")
@route("/api/v1/governance/evaluate")
@post
@summary("Evaluate a governance event")
op evaluateGovernance(...Parameters.SdkVersionHeader, @body body: GovernanceEventPayload):
  | GovernanceVerdictResponse
  | (BadRequestResponse & CoreError)
  | (UnauthorizedResponse & CoreError)
  | {
      @statusCode statusCode: 500;
      @body body: CoreError;
    };

/**
 * SDK polls this after a `require_approval` verdict. Lookup is by
 * `(workflow_id, run_id, activity_id)`; the tuple uniquely
 * identifies the activity attempt awaiting human decision.
 *
 * This endpoint uses the same runtime agent authentication as
 * `/governance/evaluate`, so agents can only poll approvals they own.
 *
 */
@tag("Governance")
@route("/api/v1/governance/approval")
@post
@summary("Poll approval status")
op pollApproval(@body body: ApprovalStatusRequest): ApprovalStatusResponse | (BadRequestResponse &
  CoreError) | (NotFoundResponse & CoreError);

namespace Parameters {
  model SdkVersionHeader {
    /** SDK semver identifier; surfaces in observability. */
    @header `X-OpenBox-SDK-Version`?: string;
  }
}
