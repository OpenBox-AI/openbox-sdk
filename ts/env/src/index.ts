export type { EnvName, EnvConfig } from './environments.js';
export { ENVIRONMENTS, resolveEnv, resolveUrls } from './environments.js';

export type { FeatureMap, TokenEntry, TokenStore } from './token-codec.js';
export { parseTokenStore, serializeTokenStore } from './token-codec.js';

export { resolveClientName } from './client-name.js';

// Generated bindings (env-var lookup table, API-key validator, OS-path
// fields) emitted from specs/typespec/env/main.tsp. Keep these
// available to consumers so they don't have to hand-roll the regex
// or the env-var list.
export {
  ENV_VAR_BINDINGS,
  validateApiKeyFormat,
  OS_PATH_FIELDS,
} from './generated/env-bindings.js';
