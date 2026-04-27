// specs/typespec/env/main.tsp - language-agnostic description of the
// runtime config that every SDK / CLI binary must resolve at startup.
//
// The TS reference implementation today (ts/env/src/) is hand-written
// - this file documents the contract it satisfies and is what the
// per-language emitters will lower to ts/env/src/generated/,
// rust/src/env/, etc. once codegen reaches them.
//
// Decorators imported from openbox-sdk/typespec-env attach metadata to
// each property so the emitters know which env-var to read, what
// regex to enforce, and which fields are filesystem paths.

// Note: programming-model spec, not an HTTP API - see govern/main.tsp
// for the rationale behind not using `@service` here.

import "openbox-sdk/typespec-env";

using OpenBox.Env;

namespace OpenboxEnv;

/** The three deployment targets every language ships with. */
enum EnvName {
  production: "production",
  staging: "staging",
  local: "local",
}

/** Per-environment URL bundle. Sourced from specs/environments.json. */
model EnvConfig {
  /** Backend management API base URL. */
  apiUrl: url;

  /** Core governance API base URL. */
  coreUrl: url;

  /** Marketing / dashboard URL. */
  platformUrl: url;
}

/**
 * Resolved runtime configuration: per-env URLs after applying any
 * environment-variable overrides. Every SDK exposes this as the
 * single thing CLI / client / core-client construction depends on.
 */
model RuntimeConfig {
  /** Selected environment name. */
  env: EnvName;

  /**
   * Backend API base URL. Falls back to ENVIRONMENTS[env].apiUrl
   * when the override is unset.
   */
  @env_var("OPENBOX_API_URL")
  apiUrl: url;

  /** Core API base URL. */
  @env_var("OPENBOX_CORE_URL")
  coreUrl: url;

  /** Platform / dashboard URL. */
  @env_var("OPENBOX_PLATFORM_URL")
  platformUrl: url;
}

/**
 * Persistent on-disk credentials. The shape is the same on every
 * platform; only the lookup path differs (XDG / %APPDATA% /
 * ~/Library/Application Support).
 */
model TokenStore {
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

  /** Selected environment when the store was written. */
  env: EnvName;
}

/**
 * Top-level "what should this binary do at startup" record. Emitters
 * generate a `loadRuntime()` function that reads OPENBOX_ENV, falls
 * back to the persisted TokenStore.env, and returns this struct.
 */
model Runtime {
  config: RuntimeConfig;
  tokens: TokenStore;
}

// ---------------------------------------------------------------------------
// Runtime contract - hand-written implementations under
// ts/env/src/*.ts (and the equivalents in rust/, py/, go/) MUST
// satisfy the operations declared on this interface. The TypeScript
// emitter lowers this to an exported `interface EnvLoader`; the
// hand-written file annotates each export with `EnvLoader['<name>']`
// so a signature drift between spec and impl fails `tsc --noEmit`.
// ---------------------------------------------------------------------------

interface EnvLoader {
  /**
   * Resolves the active environment from the CLI flag, the
   * `OPENBOX_ENV` env-var, or the production default - in that
   * order. Lower-cases the input and rejects unknown values.
   */
  resolveEnv(cliFlag?: string): EnvName;

  /**
   * Returns the URL bundle for the given environment, applying any
   * runtime overrides declared on `RuntimeConfig` (`OPENBOX_API_URL`,
   * `OPENBOX_CORE_URL`, `OPENBOX_PLATFORM_URL`).
   */
  resolveUrls(env: EnvName): EnvConfig;
}
