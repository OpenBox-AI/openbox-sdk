export type EnvName = 'production' | 'staging';

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
    coreUrl: 'https://the-core-service.node.lat',
    platformUrl: 'https://openbox.node.lat',
  },
};

export function resolveEnv(cliFlag?: string): EnvName {
  const raw = cliFlag ?? process.env.OPENBOX_ENV ?? 'production';
  const name = raw.toLowerCase();
  if (name !== 'production' && name !== 'staging') {
    console.error(`Unknown environment: ${raw}. Use 'production' or 'staging'.`);
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
