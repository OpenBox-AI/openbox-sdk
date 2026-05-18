import { ENV_VAR_BINDINGS, type EnvName } from './generated/env-bindings.js';
import { DEFAULT_ENV, DEFAULT_PLATFORM_URL, resolveEnv, resolveUrls } from './environments.js';

export interface StackEndpoints {
  apiUrl: string;
  coreUrl: string;
  authUrl?: string;
  platformUrl: string;
}

export interface OpenBoxConnection extends StackEndpoints {
  envName: EnvName;
  stackUrl?: string;
  displayName?: string;
  source: 'explicit' | 'stack-url' | 'legacy-env';
}

export interface ResolveConnectionOptions {
  envName?: EnvName | string;
  stackUrl?: string;
  apiUrl?: string;
  coreUrl?: string;
  authUrl?: string;
  platformUrl?: string;
  displayName?: string;
}

export function normalizeStackUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('OpenBox stack URL cannot be empty.');
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const url = new URL(withProtocol);
  if (url.protocol !== 'https:' && !isLoopbackHost(url.hostname)) {
    throw new Error('OpenBox stack URL must use https:// unless it points at localhost.');
  }
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

export function endpointsFromStackUrl(raw: string): StackEndpoints {
  const stackUrl = normalizeStackUrl(raw);
  const url = new URL(stackUrl);
  const rootHost = url.hostname.replace(/^(api|core|auth)\./, '');
  const origin = `${url.protocol}//`;
  return {
    apiUrl: `${origin}api.${rootHost}/ob`,
    coreUrl: `${origin}core.${rootHost}/ob`,
    authUrl: `${origin}auth.${rootHost}/ob`,
    platformUrl: stackUrl,
  };
}

export function resolveConnection(opts: ResolveConnectionOptions = {}): OpenBoxConnection {
  const envName = opts.envName ? resolveEnv(opts.envName) : DEFAULT_ENV;
  const explicitApi = opts.apiUrl ?? process.env[ENV_VAR_BINDINGS.apiUrl.name];
  const explicitCore = opts.coreUrl ?? process.env[ENV_VAR_BINDINGS.coreUrl.name];
  const explicitPlatform = opts.platformUrl ?? process.env[ENV_VAR_BINDINGS.platformUrl.name];
  const explicitAuth = opts.authUrl ?? process.env.OPENBOX_AUTH_URL;
  if (explicitApi || explicitCore || explicitPlatform || explicitAuth) {
    const stackUrl = opts.stackUrl ?? process.env.OPENBOX_STACK_URL;
    const fallback: StackEndpoints = stackUrl
      ? endpointsFromStackUrl(stackUrl)
      : { ...resolveUrls(envName), authUrl: undefined };
    return {
      envName,
      apiUrl: explicitApi ?? fallback.apiUrl,
      coreUrl: explicitCore ?? fallback.coreUrl,
      authUrl: explicitAuth ?? ('authUrl' in fallback ? fallback.authUrl : undefined),
      platformUrl: explicitPlatform ?? fallback.platformUrl,
      stackUrl,
      displayName: opts.displayName ?? process.env.OPENBOX_STACK_NAME,
      source: 'explicit',
    };
  }

  const stackUrl = opts.stackUrl ?? process.env.OPENBOX_STACK_URL;
  if (stackUrl) {
    const normalized = normalizeStackUrl(stackUrl);
    return {
      envName,
      ...endpointsFromStackUrl(normalized),
      stackUrl: normalized,
      displayName: opts.displayName ?? process.env.OPENBOX_STACK_NAME ?? new URL(normalized).hostname,
      source: 'stack-url',
    };
  }

  const legacy = resolveUrls(envName);
  return {
    envName,
    apiUrl: legacy.apiUrl,
    coreUrl: legacy.coreUrl,
    platformUrl: legacy.platformUrl || DEFAULT_PLATFORM_URL,
    source: 'legacy-env',
  };
}

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

export const DEFAULT_CONNECTION_ENV: EnvName = DEFAULT_ENV;
