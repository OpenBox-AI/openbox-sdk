export type EnvName = 'production' | 'staging' | 'local';

export interface EnvConfig {
  apiUrl: string;
  coreUrl: string;
  platformUrl: string;
}

export const ENVIRONMENTS: Record<EnvName, EnvConfig> = {
  production: {
    apiUrl: 'https://api.openbox.ai',
    coreUrl: 'https://core.openbox.ai',
    platformUrl: 'https://platform.openbox.ai',
  },
  staging: {
    apiUrl: 'https://openbox-api.node.lat',
    coreUrl: 'https://openbox-core.node.lat',
    platformUrl: 'https://openbox.node.lat',
  },
  // Local dev stack (see openbox-dev-setup). Tokens, permissions, and cached
  // features under this env are namespaced separately from prod/staging in
  // ~/.openbox/tokens so they never clobber real credentials.
  local: {
    apiUrl: 'http://localhost:3000',
    coreUrl: 'http://localhost:8086',
    platformUrl: 'http://localhost:3233',
  },
};

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
