import { TokenBucket } from 'openbox-sdk/client';

// ---------------------------------------------------------------------------
// Types - based on the-core-service @ 312df12 (2026-03-21)
// Tested against production core.openbox.ai on 2026-04-02.
//
// NOTE: The OpenAPI spec (the-core-service.yaml) diverges from the actual
// implementation in several places. These types match the IMPLEMENTATION,
// not the spec. See references/implementation-notes.md for details.
// ---------------------------------------------------------------------------

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

// Core returns lowercase verdict strings. constrain is defined but never produced.
// Core also returns a legacy `action` field for backward compat (continue/stop/require-approval).
export type GovernanceVerdict = 'allow' | 'require_approval' | 'block' | 'halt';

export interface SpanAttributes {
  // HTTP - requires http.method as gate attribute for semantic type detection
  'http.method'?: string;
  'http.url'?: string;
  'http.status_code'?: number;
  // Database - requires db.system as gate attribute (NOT db.operation alone)
  'db.system'?: string;
  'db.operation'?: string;
  'db.statement'?: string;
  // File - requires file.path as gate attribute
  'file.path'?: string;
  'file.operation'?: string;
  // LLM - gen_ai.system alone is NOT sufficient for LLM semantic detection.
  // Core's isLLMCall() (session.go:381) only detects LLM spans via HTTP POST
  // to known domains (api.openai.com, api.anthropic.com, etc.). To classify
  // spans as LLM, you must ALSO include http.method: 'POST' and http.url
  // pointing to a known LLM domain. The openbox-sdk 'gen_ai' span
  // type injects these automatically. Remove this requirement once Core honors
  // gen_ai.system directly.
  'gen_ai.system'?: string;
  [key: string]: unknown;
}

export interface SpanStatus {
  code?: string;
  description?: string;
}

/**
 * Mirror of `SpanData` in the-core-service
 * (`internal/content/governance.go`). All fields optional at the TS layer;
 * Go requires `name`, `span_id`, `trace_id`, `start_time`, `end_time` but
 * the wire is tolerant of missing values on non-billing paths.
 */
export interface SpanObject {
  // Identity
  span_id?: string;
  trace_id?: string;
  parent_span_id?: string;
  name?: string;
  kind?: string;

  // Timing - Go uses int64 nanoseconds for start/end, float/int64 for duration
  start_time?: number;
  end_time?: number;
  duration_ns?: number;

  // Core attributes
  attributes?: SpanAttributes;
  status?: SpanStatus;
  events?: Record<string, unknown>[];

  // HTTP payload (for HTTP spans)
  request_headers?: Record<string, string>;
  response_headers?: Record<string, string>;
  request_body?: string;
  response_body?: string;

  // SDK v2 root-level fields (previously stuffed in attributes or hook_trigger)
  semantic_type?: string; // e.g. http_get, llm_completion, database_select
  stage?: 'started' | 'completed' | string;
  data?: unknown; // attestation map / file-op string / arbitrary
  hook_type?: 'http_request' | 'db_query' | 'file_operation' | 'function_call' | string;
  attribute_key_identifiers?: string[];
  error?: string;

  // HTTP root fields (SDK v2)
  http_method?: string;
  http_url?: string;
  http_status_code?: number;

  // DB root fields (SDK v2)
  db_system?: string;
  db_operation?: string;
  db_statement?: string;

  // File root fields (SDK v2)
  file_path?: string;
  file_operation?: string;
}

export interface ErrorInfo {
  type: string;
  message: string;
  stack_trace?: string;
}

/**
 * Mirror of `GovernanceEventPayload` in the-core-service
 * (`internal/content/governance.go`). Fields marked `// <env>-added` are
 * present in the Go struct but not yet documented in any static spec.
 */
export interface GovernanceEventPayload {
  // Common fields (all events)
  source?: string; // e.g. "workflow-telemetry"
  event_type: GovernanceEventType;
  workflow_id: string;
  run_id: string;
  workflow_type?: string;
  // Enumerated langgraph/temporal/mastra in docs but the implementation
  // accepts any string value as a framework identifier.
  task_queue?: string;
  timestamp?: string;

  // Workflow events (WorkflowStarted, WorkflowCompleted)
  parent_workflow_id?: string;
  status?: string; // completed, failed, cancelled, terminated

  // Activity events (ActivityStarted, ActivityCompleted)
  activity_id?: string;
  activity_type?: string;
  attempt?: number;
  // IMPORTANT: activity_input MUST be an array, not an object.
  // The AGE service rejects objects with 422: "Input should be a valid list".
  // Official SDKs wrap input as a single-element array:
  //   activity_input: [{ message: "..." }]
  activity_input?: unknown[];
  activity_output?: unknown;

  // Signal events (SignalReceived)
  signal_name?: string;
  signal_args?: unknown;

  // Timing (WorkflowCompleted, ActivityCompleted)
  start_time?: number;
  end_time?: number;
  duration_ms?: number;

  // Spans (WorkflowCompleted, ActivityCompleted)
  span_count?: number;
  spans?: SpanObject[];

  // Hook trigger (mid-activity, per-HTTP-request evaluation)
  hook_trigger?: boolean;

  // SDK metadata (set server-side from X-OpenBox-SDK-Version header, semver)
  sdk_version?: string;

  // Error (WorkflowCompleted, ActivityCompleted when failed)
  error?: ErrorInfo;

  // Client-added convenience fields (not in core's Go struct, tolerated by
  // extra-field unmarshalling on the Go side but not parsed). Keep for
  // backwards compat; drop once all emitters stop sending them.
  goal?: string;
  __openbox?: { tool_type?: string; subagent_name?: string };
}

export interface GuardrailFieldResult {
  field?: string;
  order?: number;
  status?: 'allow' | 'block' | 'blocked' | 'transformed' | 'error';
  reason?: string | null;
}

/**
 * Mirror of Go's `GuardrailsVerdictResult` in
 * `internal/content/governance.go`. `GuardrailTypeResult` is kept as an
 * alias for backwards compatibility with earlier SDK versions.
 */
export interface GuardrailsVerdictResult {
  guardrail_type: string;
  results: GuardrailFieldResult[];
}

/** @deprecated Use `GuardrailsVerdictResult` - same shape, Go-aligned name. */
export type GuardrailTypeResult = GuardrailsVerdictResult;

export interface GuardrailReason {
  type: string;
  field?: string;
  reason: string;
}

/**
 * Mirror of Go's `GuardrailsResult` in `internal/content/governance.go`.
 * Go makes `input_type` / `validation_passed` required; TS marks them
 * optional because the wrapper sometimes omits the field when guardrails
 * short-circuit.
 */
export interface GuardrailsResult {
  input_type?: 'activity_input' | 'activity_output';
  redacted_input?: unknown;
  raw_logs?: Record<string, unknown>;
  validation_passed?: boolean;
  reasons?: GuardrailReason[];
  /** Detailed per-guardrail-type results (added in Go; was missing in TS). */
  results?: GuardrailsVerdictResult[];
}

export interface BehavioralResult {
  current_state?: string | null;
  next_state?: string | null;
  on_reject?: number;
  on_timeout?: number;
  pattern_name?: string | null;
  reason?: string;
  rule_id?: string | null;
  timeout_minutes?: number;
  verdict?: number;
  would_violate?: boolean;
}

/** Mirror of Go's `AGEAlignmentResult`. */
export interface AgeAlignmentResult {
  is_aligned: boolean;
  score: number;
}

/** Mirror of Go's `AGETrustScore`. Score breakdown after evaluation. */
export interface AgeTrustScore {
  trust_score: number;
  trust_tier: number;
  behavioral_compliance: number;
  alignment_consistency: number;
  aivss_baseline: number;
}

/**
 * Mirror of Go's `AGESpanResult`. Note: `trust_score_after` is an OBJECT
 * (score breakdown), not a number - the previous TS type was wrong.
 */
export interface SpanResult {
  span_id?: string;
  semantic_type?: string;
  behavioral_result?: BehavioralResult | null;
  alignment_result?: AgeAlignmentResult | null;
  trust_score_after?: AgeTrustScore | null;
  timestamp?: string;
}

/** Mirror of Go's `AGEResult`. `final_trust_score` was wrongly typed as number. */
export interface AgeResult {
  allowed?: boolean;
  verdict?: string;
  reason?: string;
  fallback_used?: boolean;
  goal_alignment_checked?: boolean;
  goal_drifted?: boolean;
  final_trust_score?: AgeTrustScore | null;
  span_results?: SpanResult[];
  total_spans?: number;
  violations_count?: number;
  response_time_ms?: number;
}

/**
 * Public response from `POST /api/v1/governance/evaluate`. Mirror of
 * `GovernanceVerdictPublicResponse.ToPublicResponse()` in
 * `internal/content/governance.go`. Required fields on the wire:
 * `governance_event_id`, `verdict`, `risk_score`, `action`.
 */
export interface GovernanceVerdictResponse {
  // Required (always present from Go's public response)
  governance_event_id?: string;
  verdict: string;
  risk_score?: number;
  action?: string; // v1.0 compat field: continue | stop | require-approval

  // v1.1 optional fields
  trust_tier?: number;
  behavioral_violations?: string[];
  approval_id?: string;
  /** List of constraints emitted for the CONSTRAIN verdict (new in v1.1). */
  constraints?: string[];
  approval_expiration_time?: string;

  // Fallback tracking
  fallback_used?: boolean;

  // v1.0 optional fields
  reason?: string;
  policy_id?: string;
  metadata?: Record<string, unknown>;
  guardrails_result?: GuardrailsResult;
  age_result?: AgeResult;
}

export interface ApprovalPollRequest {
  workflow_id: string;
  run_id: string;
  activity_id: string;
}

/**
 * Mirror of Go's `ApprovalStatusResponse` in
 * `internal/services/governance.go:215`. The wire emits `id` but earlier
 * TS had `verdict`+`expired` which Go doesn't produce - `verdict` never
 * populated, `expired` was a client-side helper. Kept here as optional
 * for backwards compat so old callers compile; new callers should use
 * `id` and derive expiry from `approval_expiration_time`.
 */
export interface ApprovalPollResponse {
  id?: string;
  action?: string;
  reason?: string;
  approval_expiration_time?: string;
  /** @deprecated Not emitted by Go; always undefined on the wire. */
  verdict?: string;
  /** @deprecated Client-side helper - derive from `approval_expiration_time` instead. */
  expired?: boolean;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type EnvName = 'production' | 'staging' | 'local';

export interface CoreClientConfig {
  /** Base URL of the Core API. Defaults to https://core.openbox.ai */
  apiUrl?: string;
  /** Agent API key (obx_live_* or obx_test_*) */
  apiKey: string;
  /** Request timeout in milliseconds. Default: 30000 */
  timeoutMs?: number;
  /** Retry configuration */
  retry?: { maxRetries?: number; initialDelayMs?: number; maxDelayMs?: number };
  /** Client-side rate limiting */
  rateLimit?: { requestsPerSecond: number; burst?: number };
  /** Target environment. Branch on this.env when prod/staging diverge. Defaults to 'production'. */
  env?: EnvName;
}

// ---------------------------------------------------------------------------
// Error wrapper
// ---------------------------------------------------------------------------

export class CoreApiError extends Error {
  public readonly status: number;
  public readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'CoreApiError';
    this.status = status;
    this.body = body;
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class OpenBoxCoreClient {
  private baseUrl: string;
  private config: CoreClientConfig;
  protected readonly env: EnvName;
  private rateLimiter: TokenBucket | null = null;

  constructor(config: CoreClientConfig) {
    this.config = { ...config };
    this.baseUrl = this.config.apiUrl ?? 'https://core.openbox.ai';
    this.env = this.config.env ?? 'production';
    if (config.rateLimit) {
      this.rateLimiter = new TokenBucket(
        config.rateLimit.requestsPerSecond,
        config.rateLimit.burst,
      );
    }
  }

  // =========================================================================
  // Public API
  // =========================================================================

  async health(): Promise<string> {
    return this.request('GET', '/') as Promise<string>;
  }

  async validateApiKey(): Promise<unknown> {
    return this.request('GET', '/api/v1/auth/validate');
  }

  async evaluate(payload: GovernanceEventPayload): Promise<GovernanceVerdictResponse> {
    return this.request('POST', '/api/v1/governance/evaluate', {
      data: payload,
    }) as Promise<GovernanceVerdictResponse>;
  }

  async pollApproval(request: ApprovalPollRequest): Promise<ApprovalPollResponse> {
    return this.request('POST', '/api/v1/governance/approval', {
      data: request,
    }) as Promise<ApprovalPollResponse>;
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  private static readonly RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

  private async request(
    method: string,
    path: string,
    options?: { data?: unknown },
  ): Promise<unknown> {
    if (this.rateLimiter) {
      await this.rateLimiter.acquire();
    }

    const url = `${this.baseUrl}${path}`;
    const timeoutMs = this.config.timeoutMs ?? 30_000;
    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
    };
    const body = options?.data ? JSON.stringify(options.data) : undefined;

    const response = await this.executeWithRetry({ url, method, headers: baseHeaders, body, timeoutMs });

    const contentType = response.headers.get('content-type');
    const isJson = contentType?.includes('application/json');

    if (!response.ok) {
      const errBody = isJson ? await response.json() : await response.text();
      throw new CoreApiError(
        `Request failed: ${response.status} ${response.statusText}`,
        response.status,
        errBody,
      );
    }

    if (!isJson) {
      return response.text();
    }

    // Core endpoints return flat JSON (not {status, data} - that's backend).
    // No envelope unwrap here: a legitimate response like { id, action, data: {...} }
    // on a future endpoint would otherwise be silently discarded.
    return response.json();
  }

  private async executeWithRetry(req: { url: string; method: string; headers: Record<string, string>; body?: string; timeoutMs: number }): Promise<Response> {
    const maxRetries = this.config.retry?.maxRetries ?? 3;
    const initialDelay = this.config.retry?.initialDelayMs ?? 500;
    const maxDelay = this.config.retry?.maxDelayMs ?? 30_000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Fresh AbortController per attempt - reusing a single timeout
      // signal across retries would fail every retry instantly. Using
      // controller + setTimeout instead of AbortSignal.timeout because
      // Hermes (React Native) doesn't ship the latter.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), req.timeoutMs);
      const fetchOptions: RequestInit = {
        method: req.method,
        headers: req.headers,
        body: req.body,
        signal: controller.signal,
      };
      try {
        const response = await fetch(req.url, fetchOptions);
        if (response.ok || !OpenBoxCoreClient.RETRYABLE_STATUSES.has(response.status)) {
          return response;
        }
        if (attempt === maxRetries) return response;
        const delay = this.calculateBackoff(attempt, initialDelay, maxDelay);
        await new Promise((r) => setTimeout(r, delay));
      } catch (err) {
        // Retry on fetch network errors (TypeError) and on per-attempt timeouts
        // (AbortError from the manual abort - a DOMException, not a TypeError).
        const isNetworkError = err instanceof TypeError;
        const isTimeout = err instanceof Error && err.name === 'AbortError';
        if (attempt === maxRetries || (!isNetworkError && !isTimeout)) throw err;
        const delay = this.calculateBackoff(attempt, initialDelay, maxDelay);
        await new Promise((r) => setTimeout(r, delay));
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error('Retry loop exited unexpectedly');
  }

  private calculateBackoff(attempt: number, initialDelay: number, maxDelay: number): number {
    const exponential = initialDelay * Math.pow(2, attempt);
    const jitter = Math.random() * initialDelay * 0.5;
    return Math.min(exponential + jitter, maxDelay);
  }
}
