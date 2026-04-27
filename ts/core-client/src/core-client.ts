import { TokenBucket } from 'openbox-sdk/client';

// Every wire-shape type in this module comes from the spec at
// specs/typespec/core/main.tsp via codegen/emitters/ts/. This file
// owns nothing but the runtime HTTP wrapper - no type redeclarations.

export type {
  EventType,
  Verdict,
  LegacyAction,
  CoreError,
  AgentValidationResponse,
  ErrorInfo,
  GovernanceEventPayload,
  SpanData,
  SpanStatus,
  SpanEvent,
  GuardrailFieldResult,
  GuardrailReason,
  GuardrailsResult,
  GuardrailsVerdictResult,
  AGEAlignmentResult,
  AGETrustScore,
  AGESpanResult,
  AGEResult,
  GovernanceVerdictResponse,
  ApprovalStatusRequest,
  ApprovalStatusResponse,
} from './generated/core-types.js';

import type {
  GovernanceEventPayload,
  GovernanceVerdictResponse,
  ApprovalStatusRequest,
  ApprovalStatusResponse,
} from './generated/core-types.js';

// Behavioral evaluator output. Spec keeps `AGESpanResult.behavioral_result`
// as `unknown` because the evaluator ships its own concrete shape; this
// declaration captures what the SDK observes today and is the only
// hand-written type in this module.
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

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type EnvName = 'production' | 'staging' | 'local';

export interface CoreClientConfig {
  /** Base URL of the Core API. Defaults to https://core.openbox.ai */
  apiUrl?: string;
  /** Agent API key (obx_live_* or obx_test_*) */
  apiKey: string;
  /** Request timeout in milliseconds. Default: 35000.
   *  Sits slightly above core's 30s WorkflowExecutionTimeout so when a
   *  workflow hits the server-side deadline, the client waits long
   *  enough to receive the 500 + actual error message instead of
   *  AbortController-cancelling first and surfacing an opaque
   *  "operation aborted". 5s margin covers handler+marshal overhead. */
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

  async pollApproval(request: ApprovalStatusRequest): Promise<ApprovalStatusResponse> {
    return this.request('POST', '/api/v1/governance/approval', {
      data: request,
    }) as Promise<ApprovalStatusResponse>;
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
    const timeoutMs = this.config.timeoutMs ?? 35_000;
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
        // credentials: 'omit' prevents RN/iOS from auto-sending cookies that
        // leaked from a WKWebView via sharedCookiesEnabled. The backend's
        // CSRF guard fires when an XSRF-TOKEN cookie is present without a
        // matching X-XSRF-TOKEN header - Bearer-auth clients don't carry
        // that header and shouldn't send cookies in the first place.
        credentials: 'omit',
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
