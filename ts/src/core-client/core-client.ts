import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { TokenBucket } from '../client/index.js';
import { normalizeServiceUrl } from '../env/connection.js';
import { API_KEY_PATTERN } from '../env/generated/env-bindings.js';
import { OPENBOX_SDK_VERSION } from '../version.js';
import { validateCoreRequest } from './generated/request-preflight.js';

// Every wire-shape type in this module comes from the spec at
// specs/typespec/core/main.tsp via codegen/emitters/ts/. This file
// owns nothing but the runtime HTTP wrapper; no type redeclarations.

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

export type ApprovalStatusResponseWithClientExpiry = ApprovalStatusResponse & {
  /**
   * Server-owned approval timeout marker. The SDK preserves this flag when
   * Core returns it, but does not derive expiry from timestamps locally.
   */
  expired?: boolean;
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface CoreClientConfig {
  /** Base URL of the Core API. Defaults to OPENBOX_CORE_URL. */
  apiUrl?: string;
  /** Agent API key (obx_live_* or obx_test_*) */
  apiKey: string;
  /**
   * Optional one-time agent identity returned by Backend `createAgent`
   * / identity rotation. Core requires these signed DID headers when
   * the agent has `signing_required=true`.
   */
  agentIdentity?: AgentIdentityConfig;
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
}

export interface AgentIdentityConfig {
  did: string;
  /** Raw Ed25519 private key bytes, base64 encoded. */
  privateKey: string;
}

const AGENT_DID_PATTERN =
  /^did:aip:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    this.config = {
      ...config,
      agentIdentity: config.agentIdentity
        ? validateAgentIdentityConfig(config.agentIdentity)
        : undefined,
    };
    this.baseUrl = requireCoreUrl(this.config.apiUrl ?? process.env.OPENBOX_CORE_URL);
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

  /**
   * Dynamic operation request used by compact API-first tooling.
   * Generated methods remain the preferred typed surface; this method
   * exists for operationId-driven callers that already resolved a
   * generated endpoint manifest entry.
   */
  async requestOperation(
    method: string,
    path: string,
    options?: {
      params?: Record<string, unknown>;
      data?: unknown;
    },
  ): Promise<unknown> {
    const renderedPath = appendQuery(path, options?.params);
    return this.request(method, renderedPath, { data: options?.data });
  }

  async health(): Promise<string> {
    return this.request('GET', '/') as Promise<string>;
  }

  async validateApiKey(): Promise<unknown> {
    return this.request('GET', '/api/v1/auth/validate');
  }

  async evaluate(payload: GovernanceEventPayload): Promise<GovernanceVerdictResponse> {
    // No retries on evaluate: each attempt the SDK constructs creates a
    // fresh workflow on Temporal (workflow_id is set by the caller in
    // the payload, but a 5xx-then-retry pattern still racks up wasted
    // attempts on the server). When core returns a 5xx after an
    // upstream deadline, retrying just amplifies the outage while
    // burning extra workflow slots. Single shot; surface the error
    // immediately so the caller can decide whether to retry with full
    // context, such as a fresh workflow_id.
    const versionedPayload =
      payload.sdk_version && payload.sdk_version !== ''
        ? payload
        : { ...payload, sdk_version: OPENBOX_SDK_VERSION };
    const response = await this.request('POST', '/api/v1/governance/evaluate', {
      data: makeGovernancePayloadJsonSafe(versionedPayload),
      retryable: false,
    }) as GovernanceVerdictResponse;
    return normalizeGovernanceChecksIncomplete(response);
  }

  async pollApproval(
    request: ApprovalStatusRequest,
  ): Promise<ApprovalStatusResponseWithClientExpiry> {
    const response = await this.request('POST', '/api/v1/governance/approval', {
      data: request,
    }) as ApprovalStatusResponse;
    return response as ApprovalStatusResponseWithClientExpiry;
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  private static readonly RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

  private async request(
    method: string,
    path: string,
    options?: { data?: unknown; retryable?: boolean },
  ): Promise<unknown> {
    if (path !== '/') {
      validateCoreRuntimeApiKey(this.config.apiKey);
    }
    validateCoreRequest(method, path, undefined, options?.data);
    if (this.rateLimiter) {
      await this.rateLimiter.acquire();
    }

    const url = `${this.baseUrl}${path}`;
    const timeoutMs = this.config.timeoutMs ?? 35_000;
    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
      'User-Agent': `OpenBox-SDK/${OPENBOX_SDK_VERSION}`,
      'X-OpenBox-SDK-Version': OPENBOX_SDK_VERSION,
      'x-openbox-internal': 'true',
    };
    const body = options?.data !== undefined ? JSON.stringify(options.data) : undefined;
    const signedHeaders = this.config.agentIdentity
      ? signAgentIdentityRequest({
        identity: this.config.agentIdentity,
        method,
        path: new URL(url).pathname,
        body,
      })
      : {};
    const headers = { ...baseHeaders, ...signedHeaders };

    // Per-call retry opt-out for non-idempotent endpoints. evaluate()
    // sets this false because each retry generates a fresh workflow on
    // Temporal; a 5xx-then-retry pattern racks up zombie workflow
    // executions and amplifies a transient 10s server-side outage from
    // a 10s user-visible delay into ~44s. Surface the 5xx immediately
    // so the caller decides whether to retry with a fresh workflow_id.
    const retryable = options?.retryable ?? true;
    const response = retryable
      ? await this.executeWithRetry({ url, method, headers, body, timeoutMs })
      : await this.executeOnce({ url, method, headers, body, timeoutMs });

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

    // Core endpoints return flat JSON (not {status, data}; that's backend).
    // No envelope unwrap here: a legitimate response like { id, action, data: {...} }
    // on a future endpoint would otherwise be silently discarded.
    return response.json();
  }

  /** Single-attempt fetch with the same per-request abort/timeout shape
   *  as one iteration of executeWithRetry. Used by endpoints that opt
   *  out of retries (evaluate). Network errors / timeouts surface as
   *  exceptions for reportAndExit; HTTP 5xx come back as Response so
   *  the caller can wrap them as CoreApiError. */
  private async executeOnce(req: { url: string; method: string; headers: Record<string, string>; body?: string; timeoutMs: number }): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    try {
      return await fetch(req.url, {
        method: req.method,
        credentials: 'omit',
        headers: req.headers,
        body: req.body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async executeWithRetry(req: { url: string; method: string; headers: Record<string, string>; body?: string; timeoutMs: number }): Promise<Response> {
    const maxRetries = this.config.retry?.maxRetries ?? 3;
    const initialDelay = this.config.retry?.initialDelayMs ?? 500;
    const maxDelay = this.config.retry?.maxDelayMs ?? 30_000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Fresh AbortController per attempt; reusing a single timeout
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
        // matching X-XSRF-TOKEN header; Bearer-auth clients don't carry
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
        // (AbortError from the manual abort; a DOMException, not a TypeError).
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

function requireCoreUrl(value: string | undefined): string {
  if (!value) throw new Error('OPENBOX_CORE_URL is required. Set the core API URL explicitly.');
  return normalizeServiceUrl('OPENBOX_CORE_URL', value);
}

function validateCoreRuntimeApiKey(value: string): void {
  if (!value) {
    throw new Error('OpenBox Core runtime API key is required for authenticated Core calls.');
  }
  if (value.startsWith('obx_key_')) {
    throw new Error(
      'OpenBox Core requires an agent runtime key (obx_live_* or obx_test_*), not an org/backend key (obx_key_*).',
    );
  }
  if (!API_KEY_PATTERN.test(value)) {
    throw new Error('OpenBox Core runtime API key must match obx_live_ or obx_test_ followed by 48 lowercase hex characters.');
  }
}

function appendQuery(path: string, params: Record<string, unknown> | undefined): string {
  if (!params) return path;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) search.append(key, String(item));
      }
    } else {
      search.append(key, String(value));
    }
  }
  const query = search.toString();
  if (!query) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${query}`;
}

function makeGovernancePayloadJsonSafe(
  payload: GovernanceEventPayload,
): GovernanceEventPayload {
  return JSON.parse(JSON.stringify(toGovernanceJsonSafe(payload))) as GovernanceEventPayload;
}

function normalizeGovernanceChecksIncomplete(
  response: GovernanceVerdictResponse,
): GovernanceVerdictResponse {
  return {
    ...response,
    governance_checks_incomplete: response.governance_checks_incomplete ?? false,
    age_result: response.age_result
      ? {
          ...response.age_result,
          governance_checks_incomplete: response.age_result.governance_checks_incomplete ?? false,
        }
      : response.age_result,
  };
}

function toGovernanceJsonSafe(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return String(value);
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Error) {
    return value.name ? `${value.name}: ${value.message}` : value.message;
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return serializeBinaryBytes(value);
  if (value instanceof DataView) return serializeDataView(value);
  if (value instanceof ArrayBuffer) return serializeBinaryBytes(new Uint8Array(value));
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  try {
    if (value instanceof Map) {
      return Object.fromEntries(
        Array.from(value.entries()).map(([entryKey, entryValue]) => [
          String(entryKey),
          toGovernanceJsonSafe(entryValue, seen),
        ]),
      );
    }
    if (value instanceof Set) {
      return Array.from(value.values()).map((entry) => toGovernanceJsonSafe(entry, seen));
    }
    if (Array.isArray(value)) {
      return value.map((entry) => toGovernanceJsonSafe(entry, seen));
    }
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === 'function') {
      try {
        return toGovernanceJsonSafe(toJSON.call(value), seen);
      } catch {
        return String(value);
      }
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        toGovernanceJsonSafe(entryValue, seen),
      ]),
    );
  } finally {
    seen.delete(value);
  }
}

function serializeDataView(value: DataView): string {
  return serializeBinaryBytes(
    new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
  );
}

function serializeBinaryBytes(value: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value);
  } catch {
    return Buffer.from(value).toString('base64');
  }
}

const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export function validateAgentIdentityConfig(
  identity: AgentIdentityConfig,
): AgentIdentityConfig {
  const did = identity.did.trim();
  const privateKey = identity.privateKey.trim();
  if (!AGENT_DID_PATTERN.test(did)) {
    throw new Error("Invalid OpenBox agent DID. Expected format 'did:aip:<uuid>'.");
  }
  decodeRawEd25519Seed(privateKey);
  return { did, privateKey };
}

export function signAgentIdentityRequest(input: {
  identity: AgentIdentityConfig;
  method: string;
  path: string;
  body?: string;
  timestamp?: string;
  nonce?: string;
}): Record<string, string> {
  const identity = validateAgentIdentityConfig(input.identity);
  const timestamp = input.timestamp ?? new Date().toISOString();
  const nonce = input.nonce ?? randomUUID();
  const bodySha256 = createHash('sha256').update(input.body ?? '').digest('hex');
  const canonical = [
    input.method.toUpperCase(),
    input.path,
    timestamp,
    nonce,
    bodySha256,
  ].join('\n');
  const privateKey = ed25519PrivateKeyFromRawBase64(identity.privateKey);
  const signature = sign(null, Buffer.from(canonical), privateKey).toString('base64');
  return {
    'X-OpenBox-Agent-DID': identity.did,
    'X-OpenBox-Agent-Timestamp': timestamp,
    'X-OpenBox-Agent-Nonce': nonce,
    'X-OpenBox-Body-SHA256': bodySha256,
    'X-OpenBox-Agent-Signature': signature,
  };
}

function ed25519PrivateKeyFromRawBase64(rawBase64: string) {
  const raw = decodeRawEd25519Seed(rawBase64);
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, raw]),
    format: 'der',
    type: 'pkcs8',
  });
}

function decodeRawEd25519Seed(rawBase64: string): Buffer {
  const privateKey = rawBase64.trim();
  const raw = Buffer.from(privateKey, 'base64');
  if (raw.length !== 32 || raw.toString('base64') !== privateKey) {
    throw new Error(
      'Invalid OpenBox agent private key. Expected a canonical base64 raw 32-byte Ed25519 key.',
    );
  }
  return raw;
}
