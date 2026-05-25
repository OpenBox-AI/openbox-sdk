// specs/typespec/env/main.tsp; language-agnostic description of the
// runtime config that every SDK / CLI binary must resolve at startup.
//
// The TS reference implementation today (ts/env/src/) is hand-written
//; this file documents the contract it satisfies and is what the
// per-language emitters will lower to ts/env/src/generated/,
// rust/src/env/, etc. once codegen reaches them.
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

  /** Stack URL used to derive endpoints when individual URLs are omitted. */
  @env_var("OPENBOX_STACK_URL")
  stackUrl?: url;
}

/**
 * Persistent on-disk credentials. The shape is the same on every
 * platform; only the lookup path differs (XDG / %APPDATA% /
 * ~/Library/Application Support).
 */
model Credentials {
  /**
   * Filesystem path to the token-store file. Resolved per-OS via the
   * platform's user-data directory helper (env-paths / dirs /
   * platformdirs).
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

/**
 * CLI-only env vars that gate which subcommands / code paths are
 * available. NOT runtime config (no URLs, no credentials); these
 * shape what the user sees in `--help` and what experimental code
 * paths run inside otherwise-stable commands.
 *
 * Spec'd here so the env-var-binding table includes them; the CLI's
 * maturity.ts + features.ts modules read these by NAME from
 * ENV_VAR_BINDINGS rather than hard-coding the strings.
 */
model CliRuntimeConfig {
  /**
   * Reveals subcommands gated as `experimental` (or `beta`). Set to
   * `experimental` to see every command in `--help`. Default: `stable`.
   * Same effect as passing `--experimental` on the openbox CLI.
   */
  @env_var("OPENBOX_EXPERIMENTAL_LEVEL")
  experimentalLevel: string;

  /**
   * Comma-separated list of feature flags to enable. Each entry is a
   * dotted path like `audit.deep-scan` or `agent.list.include-deleted`
   * matching an entry in the CLI's FEATURE_MATURITY registry.
   * Same effect as passing `--feature <name>` on the openbox CLI.
   */
  @env_var("OPENBOX_FEATURES")
  features: string;
}

// ---------------------------------------------------------------------------
// On-disk token store; wire format every language SDK must parse
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
 * the canonical flat form. Legacy scoped input is ignored and is never
 * re-emitted.
 */
interface TokenCodec {
  parseTokenStore(content: string): TokenStore;
  serializeTokenStore(store: TokenStore): string;
}

// ---------------------------------------------------------------------------
// X-Openbox-Client header composer. Every outbound request from any
// language SDK must produce the same shape: `<base>`, such as
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
 * Per-OS data scopes. Each maps to a different subdirectory under
 * the user-data directory:
 *
 *   - `tokens`: persistent OAuth tokens + API keys
 *   - `config`: declarative settings (URLs, output format)
 *   - `cache`: ephemeral state (decoded JWT claims, last-known
 *     feature flags) safe to delete
 *
 * Linux (XDG_DATA_HOME or ~/.openbox/<scope>),
 * macOS (~/.openbox/<scope>; we deliberately don't follow Apple's
 *   `~/Library/Application Support/openbox/` because the file is
 *   intended to be findable + editable from the terminal),
 * Windows (%APPDATA%\openbox\<scope>).
 */
enum OsPathScope {
  tokens: "tokens",
  config: "config",
  cache: "cache",

  /**
   * Per-agent runtime-key cache. Populated by `agent create` and
   * `api-key rotate` post-callbacks; read by `api-key recall`. The
   * file is mode 0o600 (matches `tokens`); drift-locked by
   * tests/unit/platform-awareness.test.ts.
   */
  agentKeys: "agent-keys",
}

/**
 * Resolves filesystem paths under the per-OS user-data directory.
 * Every property tagged `@os_path` somewhere in the spec resolves
 * via this contract. The implementation is hand-written per
 * language (Node uses `os.homedir()`, browser/mobile uses platform
 * SecureStore APIs) but the OUTPUT is deterministic given the
 * platform; see `tests/unit/os-paths.test.ts` for the lockdown.
 */
interface OsPathResolver {
  /**
   * Returns the absolute path for a given data scope under
   * the openbox user-data directory.
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
// implementations under ts/env/src/*.ts (and the equivalents in
// rust/, py/, go/) MUST satisfy the operations declared on this
// interface. There is no target selector beyond explicit URLs.
// ---------------------------------------------------------------------------

interface ConnectionLoader {
  /** Returns the URL bundle from explicit URLs or stack URL derivation. */
  resolveConnection(): RuntimeConfig;
}

// ---------------------------------------------------------------------------
// Client construction contract; the "set token directly" entry point.
//
// Every language's HTTP wrapper accepts these option bundles in its
// constructor. The shapes are part of the cross-language SDK contract:
// what fields can a caller pass when bootstrapping a client, and what
// happens when tokens rotate. Hand-written code on top of these is
// purely the platform-specific HTTP layer (`fetch` vs `reqwest` vs
// `requests`).
// ---------------------------------------------------------------------------

/** Cross-language retry-policy configuration. */
model RetryConfig {
  /** Maximum number of retry attempts. */
  maxRetries?: int32;
  /** Initial delay in milliseconds before first retry. */
  initialDelayMs?: int32;
  /** Maximum delay in milliseconds between retries. */
  maxDelayMs?: int32;
}

/** Cross-language rate-limit configuration. Implementations differ; the shape doesn't. */
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
 * Common shape every language SDK throws for non-2xx responses.
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
