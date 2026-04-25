// Single source of truth for env URLs is `environments.json` in this same
// directory. The JSON file is kept separate so non-TS consumers (the Rust
// approver app, future Go/Python tooling) can parse the same data without
// going through tsc.

import environmentsJson from './environments.json' with { type: 'json' };

export type EnvName = 'production' | 'staging' | 'local';

export interface EnvConfig {
  apiUrl: string;
  coreUrl: string;
  platformUrl: string;
}

export const ENVIRONMENTS: Record<EnvName, EnvConfig> = environmentsJson as Record<
  EnvName,
  EnvConfig
>;

export function resolveEnv(cliFlag?: string): EnvName {
  const raw = cliFlag ?? process.env.OPENBOX_ENV ?? 'production';
  const name = raw.toLowerCase();
  if (name !== 'production' && name !== 'staging' && name !== 'local') {
    console.error(`Unknown environment: ${raw}. Use 'production', 'staging', or 'local'.`);
    process.exit(1);
  }
  return name;
}

export function resolveUrls(env: EnvName): EnvConfig {
  const base = ENVIRONMENTS[env];
  return {
    apiUrl: process.env.OPENBOX_API_URL || base.apiUrl,
    coreUrl: process.env.OPENBOX_CORE_URL || base.coreUrl,
    platformUrl: process.env.OPENBOX_PLATFORM_URL || base.platformUrl,
  };
}
