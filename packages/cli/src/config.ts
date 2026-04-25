import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { OpenBoxClient } from '@openbox/client';
import { OpenBoxCoreClient } from '@openbox/core-client';
import {
  EnvName,
  FeatureMap,
  TokenStore,
  parseTokenStore,
  serializeTokenStore,
  resolveEnv,
  resolveUrls,
} from '@openbox/env';

function getTokenPath(): string {
  const projectTokens = resolve(process.cwd(), '.tokens');
  if (existsSync(projectTokens)) return projectTokens;
  const homeDir = resolve(process.env.HOME || '~', '.openbox');
  if (!existsSync(homeDir)) mkdirSync(homeDir, { recursive: true });
  return resolve(homeDir, 'tokens');
}

export type { FeatureMap };

function readStore(): TokenStore {
  const path = getTokenPath();
  if (!existsSync(path)) return {};
  return parseTokenStore(readFileSync(path, 'utf-8'));
}

function loadTokens(env: EnvName): { accessToken: string; refreshToken?: string } {
  const store = readStore();
  const entry = store[env];
  if (!entry?.accessToken) {
    console.error(`No tokens found for environment '${env}'.`);
    console.error(`Run: openbox ${env === 'production' ? '' : `--env ${env} `}auth login`);
    console.error(`Or:  openbox ${env === 'production' ? '' : `--env ${env} `}auth set-token <token>`);
    process.exit(1);
  }
  return { accessToken: entry.accessToken, refreshToken: entry.refreshToken };
}

function loadPermissions(env: EnvName): string[] {
  const store = readStore();
  return store[env]?.permissions ?? [];
}

function loadFeatures(env: EnvName): FeatureMap {
  const store = readStore();
  return store[env]?.features ?? {};
}

function saveTokens(
  env: EnvName,
  accessToken: string,
  refreshToken?: string,
  permissions?: string[],
) {
  const path = getTokenPath();
  const store = readStore();
  const existing = store[env] ?? {};
  store[env] = {
    accessToken,
    refreshToken: refreshToken || undefined,
    updatedAt: new Date().toISOString(),
    permissions: permissions ?? existing.permissions,
    features: existing.features,
  };
  writeFileSync(path, serializeTokenStore(store));
}

function savePermissions(env: EnvName, permissions: string[]) {
  const path = getTokenPath();
  const store = readStore();
  if (!store[env]?.accessToken) return;
  store[env] = { ...store[env], permissions };
  writeFileSync(path, serializeTokenStore(store));
}

function saveFeatures(env: EnvName, features: FeatureMap) {
  const path = getTokenPath();
  const store = readStore();
  if (!store[env]?.accessToken) return;
  store[env] = { ...store[env], features };
  writeFileSync(path, serializeTokenStore(store));
}

// Remove all persisted state for a single env (tokens, refresh, permissions,
// features). Other envs' entries are preserved. Used by `auth logout`.
function clearTokens(env: EnvName): boolean {
  const path = getTokenPath();
  const store = readStore();
  if (!store[env]) return false;
  delete store[env];
  writeFileSync(path, serializeTokenStore(store));
  return true;
}

// Non-hard-exiting check - unlike `loadTokens`, this lets callers that can
// tolerate missing tokens (e.g. `auth logout --all`) act on presence without
// being killed by process.exit.
function hasTokens(env: EnvName): boolean {
  const store = readStore();
  return !!store[env]?.accessToken;
}

// Honors OPENBOX_TIMEOUT_MS so users can stretch the per-request timeout
// for slow operations (staging core's verdict-2 evaluate workflow blocks
// for the rule's approval-timeout window before returning, easily 60s+).
// Falsy / non-finite values fall through to the SDK default (30_000).
function resolveTimeoutMs(): number | undefined {
  const raw = process.env.OPENBOX_TIMEOUT_MS;
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

function getClient(env?: EnvName): OpenBoxClient {
  const resolved = env ?? resolveEnv();
  const tokens = loadTokens(resolved);
  const { apiUrl } = resolveUrls(resolved);
  return new OpenBoxClient({
    apiUrl,
    env: resolved,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    timeoutMs: resolveTimeoutMs(),
    onTokenRefresh: (newTokens) => {
      saveTokens(resolved, newTokens.accessToken, newTokens.refreshToken);
      console.error('[token refreshed]');
    },
  });
}

function getCoreClient(env?: EnvName): OpenBoxCoreClient {
  const resolved = env ?? resolveEnv();
  const apiKey = process.env.OPENBOX_API_KEY || '';
  if (!apiKey) {
    console.error('No OPENBOX_API_KEY found. Set it in your environment.');
    process.exit(1);
  }
  const { coreUrl } = resolveUrls(resolved);
  return new OpenBoxCoreClient({
    apiUrl: coreUrl,
    apiKey,
    env: resolved,
    timeoutMs: resolveTimeoutMs(),
  });
}

export {
  getClient,
  getCoreClient,
  saveTokens,
  savePermissions,
  saveFeatures,
  clearTokens,
  hasTokens,
  loadTokens,
  loadPermissions,
  loadFeatures,
  getTokenPath,
};
