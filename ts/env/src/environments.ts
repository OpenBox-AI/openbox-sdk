// Hand-written runtime that satisfies the EnvLoader contract emitted
// from specs/typespec/env/main.tsp.
//
// What's hand-written here vs generated:
//   - Types (EnvName, EnvConfig, EnvLoader) and the URL data table
//     (ENVIRONMENTS) come from ./generated/env-bindings.ts. Do not
//     redeclare them here - TypeScript compile fails if you try.
//   - The two functions below are the actual runtime: process.env
//     lookups, error printing, the lower-case + validate dance.
//     Per-language emitters lower the same EnvLoader interface to
//     idiomatic implementations in Rust / Python / Go.
//
// Each export is annotated with `EnvLoader['<name>']` so a signature
// drift between the spec and this file is a `tsc --noEmit` failure.

import {
  ENVIRONMENTS,
  ENV_VAR_BINDINGS,
  type EnvLoader,
} from './generated/env-bindings.js';

export type { EnvName, EnvConfig, EnvLoader } from './generated/env-bindings.js';
export { ENVIRONMENTS } from './generated/env-bindings.js';

export const resolveEnv: EnvLoader['resolveEnv'] = (cliFlag) => {
  const raw = cliFlag ?? process.env.OPENBOX_ENV ?? 'production';
  const name = raw.toLowerCase();
  if (name !== 'production' && name !== 'staging' && name !== 'local') {
    console.error(`Unknown environment: ${raw}. Use 'production', 'staging', or 'local'.`);
    process.exit(1);
  }
  return name;
};

export const resolveUrls: EnvLoader['resolveUrls'] = (env) => {
  const base = ENVIRONMENTS[env];
  return {
    apiUrl: process.env[ENV_VAR_BINDINGS.apiUrl.name] || base.apiUrl,
    coreUrl: process.env[ENV_VAR_BINDINGS.coreUrl.name] || base.coreUrl,
    platformUrl: process.env[ENV_VAR_BINDINGS.platformUrl.name] || base.platformUrl,
  };
};
