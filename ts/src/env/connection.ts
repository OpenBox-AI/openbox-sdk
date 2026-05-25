import { ENV_VAR_BINDINGS, type RuntimeConfig } from './generated/env-bindings.js';

export interface StackEndpoints {
  apiUrl: string;
  coreUrl: string;
  authUrl?: string;
  platformUrl?: string;
}

export interface OpenBoxConnection extends StackEndpoints {
  stackUrl?: string;
  displayName?: string;
  source: 'explicit' | 'stack-url';
}

export interface ResolveConnectionOptions {
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

export const resolveConnection = (
  opts: ResolveConnectionOptions = {},
): OpenBoxConnection & RuntimeConfig => {
  const stackUrl = opts.stackUrl ?? process.env[ENV_VAR_BINDINGS.stackUrl.name];
  const stackEndpoints = stackUrl ? endpointsFromStackUrl(stackUrl) : undefined;
  const apiUrl = requireUrl(
    'OPENBOX_API_URL',
    opts.apiUrl ?? process.env[ENV_VAR_BINDINGS.apiUrl.name] ?? stackEndpoints?.apiUrl,
  );
  const coreUrl = requireUrl(
    'OPENBOX_CORE_URL',
    opts.coreUrl ?? process.env[ENV_VAR_BINDINGS.coreUrl.name] ?? stackEndpoints?.coreUrl,
  );
  const platformUrl =
    opts.platformUrl ?? process.env[ENV_VAR_BINDINGS.platformUrl.name] ?? stackEndpoints?.platformUrl;
  const authUrl =
    opts.authUrl ?? process.env[ENV_VAR_BINDINGS.authUrl.name] ?? stackEndpoints?.authUrl;

  return {
    apiUrl,
    coreUrl,
    platformUrl,
    authUrl,
    stackUrl,
    displayName: opts.displayName ?? process.env.OPENBOX_STACK_NAME,
    source: stackUrl && !opts.apiUrl && !opts.coreUrl ? 'stack-url' : 'explicit',
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
