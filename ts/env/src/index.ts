export type { EnvName, EnvConfig } from './environments.js';
export { ENVIRONMENTS, resolveEnv, resolveUrls } from './environments.js';

export type { FeatureMap, TokenEntry, TokenStore } from './token-codec.js';
export { parseTokenStore, serializeTokenStore } from './token-codec.js';

export { resolveClientName } from './client-name.js';

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
  // Client-construction contracts - the "set token directly" entry
  // points. Both HTTP wrappers' constructors take these shapes.
  BackendClientConfig,
  CoreClientConfig,
  RetryConfig,
  RateLimitConfig,
  TokenPair,
  ApiError,
} from './generated/env-bindings.js';
