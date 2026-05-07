// Hand-written runtime that satisfies the EnvLoader contract emitted
// from specs/typespec/env/main.tsp.
//
// What's hand-written here vs generated:
//   - Types (EnvName, EnvConfig, EnvLoader) and the URL data table
//     (ENVIRONMENTS) come from ./generated/env-bindings.ts. Do not
//     redeclare them here; TypeScript compile fails if you try.
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
  type EnvName,
} from './generated/env-bindings.js';
import buildDefaults from '../../../specs/build-defaults.json' with { type: 'json' };

export type { EnvName, EnvConfig, EnvLoader } from './generated/env-bindings.js';
export { ENVIRONMENTS } from './generated/env-bindings.js';

// Ship-time URLs. specs/build-defaults.json holds a single URL set
// with no selector field; consumers reach for these constants and stay
// agnostic to the multi-row table maintained for internal tooling.
export const DEFAULT_API_URL: string = buildDefaults.apiUrl;
export const DEFAULT_CORE_URL: string = buildDefaults.coreUrl;
export const DEFAULT_PLATFORM_URL: string = buildDefaults.platformUrl;

// Validate against the spec-emitted ENVIRONMENTS table - no string
// literals here. Adding an env to TypeSpec automatically widens what
// `resolveEnv` accepts; nothing else has to change. The default
// fallback when OPENBOX_ENV is unset is whatever `Object.keys` yields
// first (deterministic per the JSON-emit order in env-bindings.ts).
const DEFAULT_ENV = Object.keys(ENVIRONMENTS)[0] as EnvName;
export const resolveEnv: EnvLoader['resolveEnv'] = (cliFlag) => {
  const raw = cliFlag ?? process.env.OPENBOX_ENV ?? DEFAULT_ENV;
  const name = raw.toLowerCase() as EnvName;
  if (!(name in ENVIRONMENTS)) {
    // Throw rather than process.exit; this module is a library export
    // (UI / IDE consumers depend on it) and shouldn't kill its host.
    // The CLI funnels everything through reportAndExit, which produces
    // exit code 2 (USAGE) for these.
    throw new Error(
      `Unknown environment: ${raw}. Allowed: ${Object.keys(ENVIRONMENTS).join(', ')}.`,
    );
  }
  return name;
};

// Plaintext http:// is allowed for:
//   - env='local' (dev)
//   - any env when the host is loopback (localhost / 127.0.0.1 / ::1)
//    ; a packet over loopback never leaves the machine, so token-
//     in-plaintext is a theoretical not actual leak.
// All other http:// in non-local envs is rejected; protects against
// CI misconfig where OPENBOX_API_URL points at a remote attacker's
// http endpoint.
function enforceProtocol(env: string, url: string, name: string): string {
  if (env === 'local') return url;
  if (!url.startsWith('http://')) return url;
  // Permit http://localhost / http://127.0.0.1 / http://[::1] regardless
  // of env (covers e2e tests against a local stack with OPENBOX_ENV=production).
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`${name}=${url} is not a valid URL.`);
  }
  // Node's URL keeps the [] brackets on IPv6 hostnames; match both shapes.
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return url;
  throw new Error(
    `${name}=${url} uses http:// to a remote host in env '${env}'. ` +
      `Plaintext is only allowed for env='local' or loopback hosts. Use https:// or set OPENBOX_ENV=local.`,
  );
}

export const resolveUrls: EnvLoader['resolveUrls'] = (env) => {
  const base = ENVIRONMENTS[env];
  const apiUrl = process.env[ENV_VAR_BINDINGS.apiUrl.name] || base.apiUrl;
  const coreUrl = process.env[ENV_VAR_BINDINGS.coreUrl.name] || base.coreUrl;
  const platformUrl = process.env[ENV_VAR_BINDINGS.platformUrl.name] || base.platformUrl;
  return {
    apiUrl: enforceProtocol(env, apiUrl, ENV_VAR_BINDINGS.apiUrl.name),
    coreUrl: enforceProtocol(env, coreUrl, ENV_VAR_BINDINGS.coreUrl.name),
    platformUrl: enforceProtocol(env, platformUrl, ENV_VAR_BINDINGS.platformUrl.name),
  };
};
