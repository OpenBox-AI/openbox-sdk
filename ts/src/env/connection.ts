import { ENV_VAR_BINDINGS, type RuntimeConfig } from './generated/env-bindings.js';

export interface OpenBoxConnection extends RuntimeConfig {
  source: 'explicit';
}

export interface ResolveConnectionOptions {
  apiUrl?: string;
  coreUrl?: string;
  authUrl?: string;
  platformUrl?: string;
}

export const resolveConnection = (
  opts: ResolveConnectionOptions = {},
): OpenBoxConnection & RuntimeConfig => {
  const apiUrl = requireUrl(
    'OPENBOX_API_URL',
    opts.apiUrl ?? process.env[ENV_VAR_BINDINGS.apiUrl.name],
  );
  const coreUrl = requireUrl(
    'OPENBOX_CORE_URL',
    opts.coreUrl ?? process.env[ENV_VAR_BINDINGS.coreUrl.name],
  );
  const platformUrl =
    opts.platformUrl ?? process.env[ENV_VAR_BINDINGS.platformUrl.name];
  const authUrl =
    opts.authUrl ?? process.env[ENV_VAR_BINDINGS.authUrl.name];

  return {
    apiUrl,
    coreUrl,
    platformUrl,
    authUrl,
    source: 'explicit',
  };
};

function requireUrl(name: 'OPENBOX_API_URL' | 'OPENBOX_CORE_URL', value: string | undefined): string {
  if (!value) throw new Error(`${name} is required. Set explicit OpenBox service URLs.`);
  return normalizeServiceUrl(name, value);
}

function normalizeServiceUrl(name: string, raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error(`${name} cannot be empty.`);
  const url = new URL(trimmed);
  if (url.protocol !== 'https:' && !isLoopbackHost(url.hostname)) {
    throw new Error(`${name} must use https:// unless it points at localhost.`);
  }
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}
