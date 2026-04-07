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
  // LLM - requires gen_ai.system or matching span name
  'gen_ai.system'?: string;
  [key: string]: unknown;
}

export interface SpanObject {
  name?: string;
  trace_id?: string;
  span_id?: string;
  parent_span_id?: string;
  kind?: string;
  start_time?: number;
  end_time?: number;
  duration_ns?: number;
  attributes?: SpanAttributes;
  request_headers?: Record<string, string>;
  response_headers?: Record<string, string>;
  request_body?: string;
  response_body?: string;
  status?: { code?: string; description?: string };
  events?: Record<string, unknown>[];
}

export interface GovernanceEventPayload {
  event_type: GovernanceEventType;
  workflow_id: string;
  run_id: string;
  workflow_type?: string;
  activity_id?: string;
  activity_type?: string;
  // IMPORTANT: activity_input MUST be an array, not an object.
  // The OpenAPI spec says oneOf: [array, object] but the AGE service
  // (age.go) rejects objects with 422: "Input should be a valid list".
  // The official SDKs wrap input as a single-element array:
  //   activity_input: [{ message: "..." }]
  activity_input?: unknown[];
  activity_output?: unknown;
  source?: string;
  // The spec enums langgraph/temporal/mastra but the implementation
  // accepts any string value as a framework identifier.
  task_queue?: string;
  timestamp?: string;
  hook_trigger?: boolean;
  goal?: string;
  span_count?: number;
  spans?: SpanObject[];
  error?: { type?: string; message?: string };
  duration_ms?: number;
  attempt?: number;
  __openbox?: { tool_type?: string; subagent_name?: string };
}

export interface GuardrailFieldResult {
  field?: string;
  order?: number;
  status?: 'allow' | 'block' | 'blocked' | 'transformed' | 'error';
  reason?: string | null;
}

export interface GuardrailTypeResult {
  guardrail_type?: string;
  results?: GuardrailFieldResult[];
}

export interface GuardrailReason {
  type: string;
  field?: string;
  reason: string;
}

export interface GuardrailsResult {
  validation_passed?: boolean;
  input_type?: 'activity_input' | 'activity_output';
  redacted_input?: unknown;
  reasons?: GuardrailReason[];
  raw_logs?: Record<string, unknown>;
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

export interface SpanResult {
  span_id?: string;
  semantic_type?: string;
  behavioral_result?: BehavioralResult;
  alignment_result?: { is_aligned?: boolean; score?: number };
  trust_score_after?: number | null;
  timestamp?: string;
}

export interface AgeResult {
  allowed?: boolean;
  verdict?: string;
  reason?: string;
  fallback_used?: boolean;
  goal_alignment_checked?: boolean;
  goal_drifted?: boolean;
  final_trust_score?: number | null;
  span_results?: SpanResult[];
  total_spans?: number;
  violations_count?: number;
  response_time_ms?: number;
}

// Full response shape from core governance evaluation.
// Based on GovernanceVerdictResponse in governance.go:284-323.
export interface GovernanceVerdictResponse {
  governance_event_id?: string;
  verdict: string;
  risk_score?: number;
  action?: string; // legacy compat field
  reason?: string;
  policy_id?: string;
  approval_id?: string;
  trust_tier?: number;
  behavioral_violations?: string[];
  approval_expiration_time?: string;
  fallback_used?: boolean;
  metadata?: Record<string, unknown>;
  guardrails_result?: GuardrailsResult;
  age_result?: AgeResult;
}

export interface ApprovalPollRequest {
  workflow_id: string;
  run_id: string;
  activity_id: string;
}

export interface ApprovalPollResponse {
  verdict?: string;
  action?: string;
  reason?: string;
  approval_expiration_time?: string;
  expired?: boolean;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

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
  private rateLimiter: TokenBucket | null = null;

  constructor(config: CoreClientConfig) {
    this.config = { ...config };
    this.baseUrl = this.config.apiUrl ?? 'https://core.openbox.ai';
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
    const fetchOptions: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      signal: AbortSignal.timeout(timeoutMs),
    };

    if (options?.data) {
      fetchOptions.body = JSON.stringify(options.data);
    }

    const response = await this.executeWithRetry(url, fetchOptions);

    const contentType = response.headers.get('content-type');
    const isJson = contentType?.includes('application/json');

    if (!response.ok) {
      const body = isJson ? await response.json() : await response.text();
      throw new CoreApiError(
        `Request failed: ${response.status} ${response.statusText}`,
        response.status,
        body,
      );
    }

    if (!isJson) {
      return response.text();
    }

    const json = await response.json();
    // Core API uses { data } envelope on some endpoints
    if (json !== null && typeof json === 'object' && 'data' in json) {
      return json.data;
    }
    return json;
  }

  private async executeWithRetry(url: string, fetchOptions: RequestInit): Promise<Response> {
    const maxRetries = this.config.retry?.maxRetries ?? 3;
    const initialDelay = this.config.retry?.initialDelayMs ?? 500;
    const maxDelay = this.config.retry?.maxDelayMs ?? 30_000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, fetchOptions);
        if (response.ok || !OpenBoxCoreClient.RETRYABLE_STATUSES.has(response.status)) {
          return response;
        }
        if (attempt === maxRetries) return response;
        const delay = this.calculateBackoff(attempt, initialDelay, maxDelay);
        await new Promise((r) => setTimeout(r, delay));
      } catch (err) {
        if (attempt === maxRetries || !(err instanceof TypeError)) throw err;
        const delay = this.calculateBackoff(attempt, initialDelay, maxDelay);
        await new Promise((r) => setTimeout(r, delay));
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
