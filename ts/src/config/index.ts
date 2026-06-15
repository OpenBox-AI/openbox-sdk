// Public sub-path: `@openbox-ai/openbox-sdk/config`.
//
// Shared config-file readers (JSON and dotenv) used by runtime
// adapters that load a host's per-app config directory. Every
// adapter shares these parsers so the behaviour stays consistent.

export { loadJsonConfig, loadDotenv } from './host-config.js';
export {
  effectiveScope,
  setConfig,
  getConfig,
  unsetConfig,
  listConfig,
  configStorePath,
  applyConfigToProcessEnv,
  type Scope,
} from './store.js';
