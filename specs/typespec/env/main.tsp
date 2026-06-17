// specs/typespec/env/main.tsp; language-agnostic description of the
// runtime config that every SDK / CLI binary must resolve at startup.
//
// The TS reference implementation today (ts/env/src/) is hand-written
//; this file documents the contract it satisfies and is what the
// TypeScript emitter lowers to ts/src/env/generated/. Future language
// emitters should satisfy the same contract on their own release tracks.
//
// Decorators imported from typespec-env attach metadata to
// each property so the emitters know which env-var to read, what
// regex to enforce, and which fields are filesystem paths.

// Note: programming-model spec, not an HTTP API; see govern/main.tsp
// for the rationale behind not using `@service` here.

import "typespec-env";

using OpenBox.Env;

namespace OpenboxEnv;

/**
 * Resolved runtime configuration: explicit service URLs and optional
 * platform/auth endpoints. Every SDK exposes this as the
 * single thing CLI / client / core-client construction depends on.
 */
model RuntimeConfig {
  /** Backend API base URL. Required for backend-management calls. */
  @env_var("OPENBOX_API_URL")
  apiUrl: url;

  /** Core API base URL. Required for runtime/governance calls. */
  @env_var("OPENBOX_CORE_URL")
  coreUrl: url;

  /** Platform / dashboard URL. Optional UI affordance. */
  @env_var("OPENBOX_PLATFORM_URL")
  platformUrl?: url;

  /** Auth / IdP URL. Optional UI/auth affordance. */
  @env_var("OPENBOX_AUTH_URL")
  authUrl?: url;
}

/**
 * Persistent on-disk credentials. The shape is the same on every
 * platform. The default lookup path is project-local; explicit
 * `OPENBOX_HOME` is the only supported override.
 */
model Credentials {
  /**
   * Filesystem path to the token-store file. Resolved under the
   * current project's OpenBox data directory unless `OPENBOX_HOME`
   * is explicitly set.
   */
  @os_path
  path: string;

  /**
   * The agent / SDK API key. Format-checked at every read: the
   * regex matches the obx_live_<48hex> / obx_test_<48hex> shape that
   * the backend issues. Mismatched values are rejected before any
   * outbound request, so a 401 from the wire always means the key
   * is wrong, not malformed.
   */
  @env_var("OPENBOX_API_KEY")
  @token_format("^obx_(?:live|test)_[0-9a-f]{48}$")
  apiKey: string;

}

/**
 * Top-level "what should this binary do at startup" record. Emitters
 * generate a `loadRuntime()` function that reads explicit URLs and
 * credentials. There is no target selector beyond explicit URLs.
 */
model Runtime {
  config: RuntimeConfig;
  credentials: Credentials;
}

// ---------------------------------------------------------------------------
// On-disk token store; wire format every SDK target must parse
// identically. One FIELD=value line per entry. There is no env scope.
// ---------------------------------------------------------------------------

/** Flat persisted token-store entry. */
model TokenEntry {
  /** Backend JWT used for management-API auth. */
  accessToken?: string;

  /** Refresh token paired with the access token. */
  refreshToken?: string;

  /**
   * Org-level API key; alternative to `accessToken` for the
   * management API. Wire shape is `X-API-Key: <key>`; the SDK
   * prefers this header over `Authorization: Bearer` when set.
   * Format is the org-key prefix (`obx_key_<48hex>`), distinct
   * from agent runtime keys which use `obx_(live|test)_<48hex>`.
   */
  @token_format("^obx_key_[0-9a-f]{48}$")
  apiKey?: string;

  /** ISO-8601 timestamp of the last successful refresh. */
  updatedAt?: string;

  /** Per-realm RBAC permissions claimed on the JWT. */
  permissions?: string[];

  /** Org-level feature flags, decoded from the JWT. */
  features?: Record<boolean>;
}

/** On-disk token store. */
model TokenStore {
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
  updatedAt?: string;
  permissions?: string[];
  features?: Record<boolean>;
}

/**
 * String <-> TokenStore codec. Implementations must round-trip:
 * `serializeTokenStore(parseTokenStore(s)) === s'` where `s'` is
 * the canonical flat form.
 */
interface TokenCodec {
  parseTokenStore(content: string): TokenStore;
  serializeTokenStore(store: TokenStore): string;
}

// ---------------------------------------------------------------------------
// X-Openbox-Client header composer. Every outbound request from any
// SDK target must produce the same shape: `<base>`, such as
// `openbox-cli`, optionally followed by `/<variant>` where variant
// matches CLIENT_VARIANT_PATTERN. The variant comes from the explicit
// override or the OPENBOX_CLIENT_VARIANT env var. Bad values are
// silently dropped instead of throwing, so a typo cannot poison the
// header.
// ---------------------------------------------------------------------------

/**
 * Marker model carrying the canonical variant pattern via
 * `@token_format`. Re-using the env library's existing decorator
 * keeps the emitter's metadata-extraction path uniform; anything
 * format-constrained at runtime travels through `@token_format`,
 * regardless of whether it ends up as a regex literal, a CLI flag
 * validator, or both.
 */
model ClientVariant {
  /**
   * `OPENBOX_CLIENT_VARIANT` pattern. Letters, digits, `.`, `_`,
   * `+`, `-`; the conservative intersection of HTTP-header-safe
   * and shell-safe characters.
   */
  @token_format("^[A-Za-z0-9._+-]+$")
  value: string;
}

/**
 * Project-local data scopes. Each maps to a different subpath under
 * the active OpenBox data root:
 *
 *   - `tokens`: persistent OAuth tokens + API keys
 *   - `config`: declarative settings (URLs, output format)
 *   - `cache`: ephemeral state (decoded JWT claims, last-known
 *     feature flags) safe to delete
 *
 * Default: `<cwd>/.openbox/<scope>`.
 * Override: `<OPENBOX_HOME>/<scope>`.
 */
enum OsPathScope {
  tokens: "tokens",
  config: "config",
  cache: "cache",

  /**
   * Per-agent runtime-key cache. Populated by backend/runtime-key
   * flows and read by host runtimes. The
   * file is mode 0o600 (matches `tokens`); drift-locked by
   * tests/unit/platform-awareness.test.ts.
   */
  agentKeys: "agent-keys",
}

/**
 * Resolves filesystem paths under the project-local OpenBox data
 * directory.
 * Every property tagged `@os_path` somewhere in the spec resolves
 * via this contract. The implementation is hand-written per
 * language but the default must not read or write global/user-level
 * OpenBox state; see `tests/unit/os-paths.test.ts` for the lockdown.
 */
interface OsPathResolver {
  /**
   * Returns the absolute path for a given data scope under
   * the active project-local OpenBox data directory.
   */
  resolveOsPath(scope: OsPathScope): string;
}

interface ClientNameResolver {
  /**
   * Compose the `X-Openbox-Client` header value. Returns `base`
   * verbatim when no variant is supplied; otherwise returns
   * `<base>/<variant>` if the variant matches
   * `CLIENT_VARIANT_PATTERN`, or `base` alone if it doesn't (the
   * implementation logs a warning to stderr in that case).
   */
  resolveClientName(base: string, variant?: string): string;
}

// ---------------------------------------------------------------------------
// ConnectionLoader; runtime contract for URL resolution. Hand-written
// implementations under ts/src/env/*.ts MUST satisfy the operations
// declared on this interface. Future SDK targets should implement the same
// interface on their own release tracks. There is no target selector beyond
// explicit URLs.
// ---------------------------------------------------------------------------

interface ConnectionLoader {
  /** Returns the URL bundle from explicit URLs or stack URL derivation. */
  resolveConnection(): RuntimeConfig;
}

// ---------------------------------------------------------------------------
// Client construction contract; the "set token directly" entry point.
//
// Every SDK target's HTTP wrapper accepts these option bundles in its
// constructor. The shapes are part of the cross-target SDK contract:
// what fields can a caller pass when bootstrapping a client, and what
// happens when tokens rotate. Hand-written code on top of these is
// purely the platform-specific HTTP layer (`fetch` vs `reqwest` vs
// `requests`).
// ---------------------------------------------------------------------------

/** Cross-target retry-policy configuration. */
model RetryConfig {
  /** Maximum number of retry attempts. */
  maxRetries?: int32;
  /** Initial delay in milliseconds before first retry. */
  initialDelayMs?: int32;
  /** Maximum delay in milliseconds between retries. */
  maxDelayMs?: int32;
}

/** Cross-target rate-limit configuration. Implementations differ; the shape doesn't. */
model RateLimitConfig {
  /** Maximum requests per second. */
  requestsPerSecond: float64;
  /** Burst capacity; defaults to `requestsPerSecond` when unset. */
  burst?: float64;
}

/** OAuth-style token pair returned by `login()` and the refresh endpoint. */
model TokenPair {
  accessToken: string;
  /**
   * Optional; Keycloak rotation may be disabled, in which case the
   * stored refresh token should be left as-is rather than overwritten.
   */
  refreshToken?: string;
}

/**
 * Construction options for the backend HTTP wrapper. Required entry
 * point for the "I already have a token, just use it" flow; pass
 * exactly one of `accessToken` (JWT, browser/login flow) or `apiKey`
 * (org-level long-lived key, X-API-Key header). The wrapper picks the
 * apiKey path when both are present.
 */
model BackendClientConfig {
  /** Base URL of the backend API. */
  apiUrl?: url;

  /**
   * Bearer access token (JWT). Either this or `apiKey` is required.
   * When both are set, `apiKey` wins.
   */
  accessToken?: string;

  /** Optional refresh token for automatic token renewal. */
  refreshToken?: string;

  /**
   * Org-level API key; sent as `X-API-Key`. Either this or
   * `accessToken` is required; format-checked at construction so
   * a 401 from the wire always means the key is wrong, not malformed.
   */
  @token_format("^obx_key_[0-9a-f]{48}$")
  apiKey?: string;

  /**
   * Telemetry identifier sent in `X-Openbox-Client`. Each consumer
   * (CLI, mobile, MCP, ...) sets its own; the env library composes
   * the final header value via `ClientNameResolver`.
   */
  clientName?: string;

  /** Request timeout in milliseconds. */
  timeoutMs?: int32;

  retry?: RetryConfig;
  rateLimit?: RateLimitConfig;

  /**
   * Cached set of permission strings the holder of `accessToken` is
   * authorized for, such as `["read:agent", "create:webhook"]`. When
   * provided, the generated wrapper class checks each method's
   * required permissions BEFORE the network call and throws a typed
   * `MissingPermissionError` if any are absent.
   *
   * When omitted, the pre-flight check is skipped; the SDK behaves
   * exactly as before, deferring authorization to the server's 403
   * response. The CLI populates this from its on-disk perms cache.
   */
  permissions?: string[];
}

/**
 * Construction options for the core HTTP wrapper. The SDK API key
 * (`apiKey`) is required; same "I already have a key, just use it"
 * flow as `BackendClientConfig.accessToken`. Format-checked at
 * construction via `validateApiKeyFormat` so a 401 from the wire
 * always means the key is wrong, not malformed.
 */
model CoreClientConfig {
  apiUrl?: url;

  @token_format("^obx_(?:live|test)_[0-9a-f]{48}$")
  apiKey: string;

  timeoutMs?: int32;
  retry?: RetryConfig;
  rateLimit?: RateLimitConfig;
}

/**
 * Common shape every SDK target throws for non-2xx responses.
 * Consumers branch on `status` and `body` to pull out structured
 * error details from the wrapped service.
 */
model ApiError {
  /** Human-readable message; usually mirrors `body.message` when present. */
  message: string;

  /** HTTP status code from the failing response. */
  status: int32;

  /** Parsed response body, or `null` if the body wasn't JSON. */
  body: unknown;
}
