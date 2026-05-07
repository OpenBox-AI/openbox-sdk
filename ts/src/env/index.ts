export type { EnvName, EnvConfig } from './environments.js';
export { ENVIRONMENTS, resolveEnv, resolveUrls } from './environments.js';
export { DEFAULT_API_URL, DEFAULT_CORE_URL, DEFAULT_PLATFORM_URL, DEFAULT_ENV } from './environments.js';

export type { FeatureMap, TokenEntry, TokenStore } from './token-codec.js';
export { parseTokenStore, serializeTokenStore } from './token-codec.js';

export { resolveClientName } from './client-name.js';
export { buildAuthHeader } from './auth-header.js';

// Per-OS data-path resolver lives at the `openbox-sdk/os-paths` sub-path
// instead of the default entry. The implementation imports Node's `os`
// and `path` modules which React Native's Metro bundler can't resolve;
// keeping it off the default entry means RN/browser consumers don't pull
// Node-only code through this package. Node-only consumers (CLI) do:
//   import { resolveOsPath } from '../env/os-paths.js';
// The TYPES are safe to re-export from here; they're spec-driven, not
// platform-coupled.
export type { OsPathResolver, OsPathScope } from './generated/env-bindings.js';

// Generated bindings (env-var lookup table, API-key validator, OS-path
// fields, client-construction shapes) emitted from
// specs/typespec/env/main.tsp.
export {
  ENV_VAR_BINDINGS,
  validateApiKeyFormat,
  OS_PATH_FIELDS,
  CLIENT_VARIANT_PATTERN,
} from './generated/env-bindings.js';

export type {
  // Client-construction contracts; the "set token directly" entry
  // points. Both HTTP wrappers' constructors take these shapes.
  BackendClientConfig,
  CoreClientConfig,
  RetryConfig,
  RateLimitConfig,
  TokenPair,
  ApiError,
} from './generated/env-bindings.js';
