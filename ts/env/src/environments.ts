// Single source of truth for env URLs is specs/environments.json at the
// monorepo root. Every language's env package reads the same file, so
// URL data stays in lockstep across the codegen pipeline.

import environmentsJson from '../../../specs/environments.json' with { type: 'json' };

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
