import { isTokenExpired } from '../types/index.js';
import { resolveClientName, buildAuthHeader } from '../env/index.js';
import { TokenBucket } from './rate-limiter.js';
import type {
  PaginationQuery,
  MetricsQuery,
  ApprovalListQuery,
  SessionListQuery,
  AivssConfig,
  GoalAlignmentConfig,
  UpdateGuardrailDto,
  UpdateBehaviorRuleDto,
  TestGuardrailDto,
  EvaluateRegoDto,
  CreateOrganizationDto,
  PaginatedResponse,
  MessageResponse,
  Agent,
  Guardrail,
  BehaviorRule,
  Session,
  TrustEvent,
  TrustTierChange,
  Assessment,
  Approval,
  OrgApprovalsResponse,
  Violation,
  Organization,
} from '../types/index.js';

// ---------------------------------------------------------------------------
// Configuration
//
// Spec source: specs/typespec/env/main.tsp (BackendClientConfig,
// RetryConfig, RateLimitConfig, ApiError). Re-exported here under the
// legacy public names so existing consumers keep compiling. The
// `onTokenRefresh` callback below is the only TypeScript-specific
// extension; future SDK targets can expose equivalent token-rotation
// hooks in their platform-native style. This one stays hand-written.
// ---------------------------------------------------------------------------

import type {
  BackendClientConfig as SpecBackendClientConfig,
  RetryConfig,
  RateLimitConfig,
} from '../env/index.js';

/**
 * Backend HTTP client configuration. Mirrors `BackendClientConfig` in
 * `specs/typespec/env/main.tsp`; the `onTokenRefresh` callback is a
 * TS-only extension (other languages handle rotation differently and
 * don't need the user-side hook).
 */
export interface ClientConfig extends SpecBackendClientConfig {
  /**
   * Callback invoked when tokens are refreshed so the caller can
   * persist them. `refreshToken` may be undefined when Keycloak
   * rotation is disabled; in that case the stored refresh token
   * should stay as-is, not be overwritten.
   */
  onTokenRefresh?: (tokens: { accessToken: string; refreshToken: string | undefined }) => void;
}

// ---------------------------------------------------------------------------
// Error wrapper; concrete class implementing the spec's `ApiError`
// model. The class form is TS-specific (Error inheritance); the
// fields (`message`, `status`, `body`) come from the spec.
// ---------------------------------------------------------------------------

import type { ApiError } from '../env/index.js';

export class OpenBoxApiError extends Error implements ApiError {
  public readonly status: number;
  public readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'OpenBoxApiError';
    this.status = status;
    this.body = body;
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

import { CANONICAL_SDK_VOCAB } from '../core-client/generated/govern.js';
import { validateBackendRequest } from './generated/request-preflight.js';
import { OpenBoxClientWrapperBase } from './generated/wrapper-methods.js';

export class OpenBoxClient extends OpenBoxClientWrapperBase {
  private baseUrl: string;
  private config: ClientConfig;
  protected readonly clientName: string;
  private refreshPromise: Promise<void> | null = null;
  private rateLimiter: TokenBucket | null = null;

  // Auto-refresh is currently DISABLED. The upstream `/auth/refresh`
  // endpoint has known compatibility gaps with the dashboard's snake_case
  // payload and Keycloak realm resolution. Flip to true once both fixes
  // ship. The capture path in the CLI continues to save refresh tokens
  // so no re-login is needed after re-enabling.
  private static readonly REFRESH_ENABLED = false;

  /**
   * Fetch a service's `/version` payload. Public endpoint; no auth, no
   * client construction. Works for any OpenBox HTTP service that exposes
   * `/version` (backend, core, future services). Backend wraps as
   * { status, data: {...} }; core returns flat; both shapes are normalized.
   *
   * Returns null on any error (timeout, network, non-OK, malformed body).
   * Callers decide how to continue.
   */
  static async getVersion(
    baseUrl: string,
    options?: { timeoutMs?: number },
  ): Promise<{ commit?: string; version?: string; builtAt?: string } | null> {
    if (!baseUrl) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? 5_000);
    try {
      const res = await fetch(`${baseUrl}/version`, {
        method: 'GET',
        credentials: 'omit',
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const raw = (await res.json()) as Record<string, unknown>;
      const payload =
        raw.data && typeof raw.data === 'object'
          ? (raw.data as Record<string, unknown>)
          : raw;
      const commit = typeof payload.commit === 'string' ? payload.commit : undefined;
      const version = typeof payload.version === 'string' ? payload.version : undefined;
      // Backend serializes as `builtAt`; core (Go/Echo) as `built_at`.
      // Accept both so the same SDK call works against either service.
      const builtAt =
        typeof payload.builtAt === 'string'
          ? payload.builtAt
          : typeof payload.built_at === 'string'
            ? payload.built_at
            : undefined;
      if (!commit && !version && !builtAt) return null;
      return { commit, version, builtAt };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  constructor(config: ClientConfig) {
    super();
    // No auth-required check at construction: public endpoints
    // (login, health, version, register) are valid usages without
    // any credential. Authenticated calls fail at request time with
    // the backend's 401 (which buildAuthHeader reports clearly when
    // both apiKey and accessToken are unset).
    this.config = { ...config };
    this.baseUrl = requireApiUrl(this.config.apiUrl ?? process.env.OPENBOX_API_URL);
    // Emit the configured client name without consulting host-specific env.
    // Host adapters that need a variant should pass it through config.
    this.clientName = resolveClientName(this.config.clientName ?? 'openbox-cli');
    // Populate the wrapper-base permissions cache so generated methods can
    // pre-flight against MissingPermissionError before any network call.
    // Caller leaves `permissions` undefined to disable the check.
    if (config.permissions) {
      this.permissions = new Set(config.permissions);
    }
    if (config.rateLimit) {
      this.rateLimiter = new TokenBucket(
        config.rateLimit.requestsPerSecond,
        config.rateLimit.burst,
      );
    }
  }

  /**
   * Dynamic operation request used by compact API-first tooling.
   * Generated wrapper methods remain the preferred typed surface; this
   * method exists for operationId-driven callers that already resolved
   * a generated endpoint manifest entry.
   */
  async requestOperation(
    method: string,
    path: string,
    options?: {
      params?: Record<string, unknown>;
      data?: unknown;
    },
  ): Promise<unknown> {
    return this.request(method, path, options);
  }

  /**
   * Update the cached permission set. Call this after a token refresh
   * that returned new claims, or after `getProfile()` if the consumer
   * didn't pre-load permissions at construction time. Pass `undefined`
   * to disable the pre-flight check entirely.
   */
  setPermissions(permissions: string[] | undefined): void {
    this.permissions = permissions ? new Set(permissions) : undefined;
  }

  // =========================================================================
  // Auth
  // =========================================================================


  /**
  // =========================================================================
  // Agent CRUD
  // =========================================================================

  // listAgents / registerOrganization come from the generated base.


  // Every backend operation comes from the spec-emitted
  // OpenBoxClientWrapperBase. The hand-written wrappers below are gone
  // per the no-legacy-support rule; callers reach for the generated
  // method directly. Where the spec under-declares a response (the
  // generated method returns `unknown`), the call site casts through
  // the wire-shape it depends on so the drift is visible at the use,
  // not hidden in a hand-typed return.



  // ---- removed: every method here was a hand-written wrapper around
  // the generated typed method on OpenBoxClientWrapperBase. After the
  // ResponseOf<> emitter fix the generated methods carry the real
  // response types; the legacy wrappers are gone.
  // =========================================================================
  // User
  // =========================================================================


  // =========================================================================
  // Pagination helpers
  // =========================================================================

  /**
   * Async generator that yields pages from a paginated endpoint.
   * The `fetcher` receives `{ page, perPage }` and must return a `PaginatedResponse<T>`.
   *
   * @example
   * for await (const page of client.paginate((q) => client.listAgents(q))) {
   *   console.log(page); // Agent[]
   * }
   */
  async *paginate<T>(
    fetcher: (query: { page: number; perPage: number }) => Promise<PaginatedResponse<T>>,
    perPage: number = 50,
  ): AsyncGenerator<T[], void, undefined> {
    let page = 0;
    while (true) {
      const result = await fetcher({ page, perPage });
      const items = result.data ?? [];
      if (items.length === 0) break;
      yield items;
      if (items.length < perPage) break;
      page++;
    }
  }

  /**
   * Fetches all items from a paginated endpoint by auto-paginating.
   *
   * @example
   * const allAgents = await client.paginateAll((q) => client.listAgents(q));
   */
  async paginateAll<T>(
    fetcher: (query: { page: number; perPage: number }) => Promise<PaginatedResponse<T>>,
    perPage: number = 50,
  ): Promise<T[]> {
    const all: T[] = [];
    for await (const page of this.paginate(fetcher, perPage)) {
      all.push(...page);
    }
    return all;
  }

  // =========================================================================
  // API keys; live backend, org-scoped, gated on create/read/update/delete:api_key
  // =========================================================================






  // =========================================================================
  // Webhooks; live backend, gated on create/read/update/delete:webhook
  // =========================================================================








  // =========================================================================
  // =========================================================================
  // Private helpers
  // =========================================================================

  /**
   * Ensures the access token is still valid. If it is expired (or will be
   * within 60 s) and a refresh token is available, performs an automatic
   * token refresh. Multiple concurrent callers share the same refresh promise
   * to avoid redundant refresh requests.
   */
  private async ensureValidToken(): Promise<void> {
    // When refresh is disabled, skip the pre-emptive expiry gate
    // entirely. The 60s safety buffer in isTokenExpired makes
    // freshly-issued tokens look "expired" even though the server
    // would accept them. This bites tokens captured from an SSO
    // callback or short Keycloak lifespans. Without a refresh path
    // there is nothing we'd do here anyway; let the request fly and
    // trust the server's
    // 401 if the token is genuinely dead. CLI bypasses this whole
    // method via raw fetch() and works fine; same intent here.
    if (!OpenBoxClient.REFRESH_ENABLED) {
      return;
    }

    // API-key auth has no expiry and no refresh path; let the request fly.
    if (!this.config.accessToken) {
      return;
    }

    if (!isTokenExpired(this.config.accessToken)) {
      return;
    }

    if (!this.config.refreshToken) {
      throw new OpenBoxApiError(
        'Access token is expired and no refresh token was provided',
        401,
        null,
      );
    }

    // Deduplicate concurrent refresh attempts
    if (!this.refreshPromise) {
      this.refreshPromise = this.performTokenRefresh();
    }
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async performTokenRefresh(): Promise<void> {
    try {
      const url = `${this.baseUrl}/auth/refresh`;
      const response = await fetch(url, {
        method: 'POST',
        // See request() above for the credentials: 'omit' rationale .
        // same CSRF-cookie-leak applies to the refresh endpoint.
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/json',
          'X-Openbox-Client': this.clientName,
          Authorization: `Bearer ${this.config.accessToken}`,
        },
        body: JSON.stringify({ refreshToken: this.config.refreshToken }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new OpenBoxApiError(
          `Token refresh failed: ${response.status} ${response.statusText}`,
          response.status,
          body,
        );
      }

      const body = await response.json();
      // Response may be wrapped ({data: {...}}), flat ({...}), or use snake_case
      // depending on whether we hit the NestJS wrapper or Keycloak directly.
      const data = body?.data ?? body ?? {};
      const newAccess: string | undefined = data.accessToken ?? data.access_token;
      const newRefresh: string | undefined = data.refreshToken ?? data.refresh_token;

      if (!newAccess) {
        throw new OpenBoxApiError(
          `Token refresh returned no access token (keys: ${Object.keys(data).join(',')})`,
          500,
          body,
        );
      }

      this.config.accessToken = newAccess;
      if (newRefresh) this.config.refreshToken = newRefresh;

      if (this.config.onTokenRefresh) {
        // Preserve the refresh token when rotation does not return a new one.
        this.config.onTokenRefresh({
          accessToken: this.config.accessToken,
          refreshToken: this.config.refreshToken,
        });
      }
    } catch (err) {
      if (err instanceof OpenBoxApiError) throw err;
      const message =
        err instanceof Error ? `Token refresh failed: ${err.message}` : 'Token refresh failed';
      throw new OpenBoxApiError(message, 401, err);
    }
  }

  // -------------------------------------------------------------------------
  // Retry helpers
  // -------------------------------------------------------------------------

  // Spec-driven (CANONICAL_SDK_VOCAB.retryableStatuses, from @sdkVocab).
  private static readonly RETRYABLE_STATUSES = new Set<number>(
    CANONICAL_SDK_VOCAB.retryableStatuses,
  );

  private async executeWithRetry(url: string, fetchOptions: RequestInit): Promise<Response> {
    const maxRetries = this.config.retry?.maxRetries ?? 3;
    const initialDelay = this.config.retry?.initialDelayMs ?? 500;
    const maxDelay = this.config.retry?.maxDelayMs ?? 30_000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, fetchOptions);

        if (response.ok || !OpenBoxClient.RETRYABLE_STATUSES.has(response.status)) {
          return response;
        }

        if (attempt === maxRetries) {
          return response; // let caller throw OpenBoxApiError
        }

        const delay = this.getRetryDelay(response, attempt, initialDelay, maxDelay);
        await this.sleep(delay);
      } catch (err) {
        // Network errors (TypeError from fetch)
        if (attempt === maxRetries || !(err instanceof TypeError)) {
          throw err;
        }
        const delay = this.calculateBackoff(attempt, initialDelay, maxDelay);
        await this.sleep(delay);
      }
    }

    throw new Error('Retry loop exited unexpectedly');
  }

  private getRetryDelay(
    response: Response,
    attempt: number,
    initialDelay: number,
    maxDelay: number,
  ): number {
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      if (retryAfter) {
        const seconds = Number(retryAfter);
        if (!isNaN(seconds)) {
          return Math.min(seconds * 1000, maxDelay);
        }
        const date = Date.parse(retryAfter);
        if (!isNaN(date)) {
          return Math.min(Math.max(date - Date.now(), 0), maxDelay);
        }
      }
    }
    return this.calculateBackoff(attempt, initialDelay, maxDelay);
  }

  private calculateBackoff(attempt: number, initialDelay: number, maxDelay: number): number {
    const exponential = initialDelay * Math.pow(2, attempt);
    const jitter = Math.random() * initialDelay * 0.5;
    return Math.min(exponential + jitter, maxDelay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // -------------------------------------------------------------------------
  // Core request pipeline
  // -------------------------------------------------------------------------

  /**
   * Generic request method using native fetch with retry and rate limiting.
   */
  private async request(
    method: string,
    path: string,
    options?: {
      params?: Record<string, unknown>;
      data?: unknown;
    },
  ): Promise<unknown> {
    // Pre-flight permission check. Throws MissingPermissionError BEFORE
    // we touch the network when the cached perm set doesn't cover this
    // (verb, path) tuple. No-op when permissions are unset (legacy).
    // Sits at the request() layer so generated methods AND any
    // hand-written shadow that calls http* hits the same gate.
    this.checkPathPermissions(method, path);
    validateBackendRequest(method, path, options?.params, options?.data);

    await this.ensureValidToken();

    if (this.rateLimiter) {
      await this.rateLimiter.acquire();
    }

    let url = `${this.baseUrl}${path}`;
    if (options?.params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(options.params)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          // Repeat the key per element so the backend parses it as an
          // array (`tiers=2&tiers=3`) instead of a comma-joined scalar
          // string from `String([...])`. Without this, server-side
          // array filters like `tiers[]` and `team_ids[]` silently
          // miss and return unfiltered results.
          for (const v of value) {
            if (v !== undefined && v !== null) searchParams.append(key, String(v));
          }
        } else {
          searchParams.append(key, String(value));
        }
      }
      const qs = searchParams.toString();
      if (qs) url += `?${qs}`;
    }

    const timeoutMs = this.config.timeoutMs ?? 30_000;
    // AbortController + setTimeout instead of AbortSignal.timeout .
    // Hermes (React Native's JS engine) doesn't ship AbortSignal.timeout.
    // The controller pattern is supported across Node, browsers, and RN.
    // executeWithRetry handles request lifecycle so the timer is cleared
    // after the response (or its error) lands.
    const buildOptions = (): { init: RequestInit; cancel: () => void } => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      // X-API-Key wins over Bearer when both are set; the SDK's
      // canonical buildAuthHeader keeps this in lockstep with the
      // MCP server (and any future fetch-level consumer).
      const authHeader = buildAuthHeader({
        apiKey: this.config.apiKey,
        accessToken: this.config.accessToken,
      });
      return {
        init: {
          method,
          // credentials: 'omit' prevents RN/iOS from auto-sending cookies
          // leaked from a WKWebView via sharedCookiesEnabled. The backend's
          // CSRF guard (jwt-auth.guard.ts) fires when an XSRF-TOKEN cookie
          // is present without a matching X-XSRF-TOKEN header; JWT-only
          // clients (CLI, mobile SDK) don't have the header, so they 401.
          // Omitting cookies entirely is the right behavior for a Bearer-auth
          // API client; cookies should never affect SDK requests.
          credentials: 'omit',
          headers: {
            'Content-Type': 'application/json',
            ...authHeader,
            // Required by the backend's auth guard; presence-only check, value is arbitrary.
            // Each consumer sets its own via ClientConfig.clientName.
            'X-Openbox-Client': this.clientName,
          },
          signal: controller.signal,
          body: options?.data !== undefined ? JSON.stringify(options.data) : undefined,
        },
        cancel: () => clearTimeout(timer),
      };
    };

    const first = buildOptions();
    let response: Response;
    try {
      response = await this.executeWithRetry(url, first.init);
    } finally {
      first.cancel();
    }

    // Reactive refresh path: DISABLED. See ensureValidToken() for context.
    // Leaving the code shape here so flipping REFRESH_ENABLED is a single
    // boolean change.
    if (
      OpenBoxClient.REFRESH_ENABLED &&
      response.status === 401 &&
      this.config.accessToken &&
      this.config.refreshToken
    ) {
      try {
        await this.performTokenRefresh();
        const retry = buildOptions();
        try {
          response = await this.executeWithRetry(url, retry.init);
        } finally {
          retry.cancel();
        }
      } catch {
        /* fall through to the original 401 */
      }
    }
    // (No console.error on the 401 branch either; same reason as
    // ensureValidToken's expired-token branch above. The OpenBoxApiError
    // thrown below carries the status; consumers handle the surface.)

    const contentType = response.headers.get('content-type');
    const isJson = contentType?.includes('application/json');

    if (!response.ok) {
      const body = isJson ? await response.json() : await response.text();
      throw new OpenBoxApiError(
        `Request failed: ${response.status} ${response.statusText}`,
        response.status,
        body,
      );
    }

    if (!isJson) {
      const text = await response.text();
      return text as unknown;
    }

    const json = await response.json();
    return this.unwrap(json);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // HTTP helpers exposed to the generated wrapper base class (and to
  // hand-written overrides for endpoints that need bespoke logic). The
  // `http` prefix avoids name clashes with wire methods like
  // `getProfile` / `postEvent` that TypeScript would otherwise read as
  // overloads of an unprefixed `get` / `post`.
  protected async httpGet<T>(
    path: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params?: any,
  ): Promise<T> {
    return this.request('GET', path, { params }) as Promise<T>;
  }

  protected async httpPost<T>(path: string, data?: unknown): Promise<T> {
    return this.request('POST', path, { data }) as Promise<T>;
  }

  protected async httpPut<T>(
    path: string,
    data?: unknown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params?: any,
  ): Promise<T> {
    return this.request('PUT', path, { data, params }) as Promise<T>;
  }

  protected async httpPatch<T>(path: string, data?: unknown): Promise<T> {
    return this.request('PATCH', path, { data }) as Promise<T>;
  }

  protected async httpDelete<T>(path: string, data?: unknown): Promise<T> {
    return this.request('DELETE', path, { data }) as Promise<T>;
  }

  /**
   * Unwraps the standard `{ status, data }` response envelope used by the
   * OpenBox API. If the response does not match the envelope shape, it is
   * returned as-is.
   */
  private unwrap(response: unknown): unknown {
    if (
      response !== null &&
      typeof response === 'object' &&
      'data' in (response as Record<string, unknown>)
    ) {
      return (response as Record<string, unknown>).data;
    }
    return response;
  }
}

function requireApiUrl(value: string | undefined): string {
  if (!value) throw new Error('OPENBOX_API_URL is required. Set the backend API URL explicitly.');
  const url = new URL(value);
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}
