import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { OpenBoxClient } from '@openbox/client';
import { OpenBoxCoreClient } from '@openbox/core-client';
import { EnvName, resolveEnv, resolveUrls } from './environments.js';

function getTokenPath(): string {
  const projectTokens = resolve(process.cwd(), '.tokens');
  if (existsSync(projectTokens)) return projectTokens;
  const homeDir = resolve(process.env.HOME || '~', '.openbox');
  if (!existsSync(homeDir)) mkdirSync(homeDir, { recursive: true });
  return resolve(homeDir, 'tokens');
}

export type FeatureMap = Record<string, boolean>;

type TokenEntry = {
  accessToken?: string;
  refreshToken?: string;
  updatedAt?: string;
  permissions?: string[];
  /** Per-env feature flags from GET /organization/{orgId}/features (api_keys, webhooks, sso). */
  features?: FeatureMap;
};
type TokenStore = Partial<Record<EnvName, TokenEntry>>;

function parseStore(content: string): TokenStore {
  const store: TokenStore = {};
  const legacy: TokenEntry = {};
  for (const line of content.split('\n')) {
    const m = line.match(/^(\w+(?:\.\w+)?)=(.*)$/);
    if (!m) continue;
    const key = m[1];
    const value = m[2];
    const dot = key.indexOf('.');
    if (dot === -1) {
      if (key === 'ACCESS_TOKEN') legacy.accessToken = value;
      else if (key === 'REFRESH_TOKEN') legacy.refreshToken = value || undefined;
      else if (key === 'UPDATED_AT') legacy.updatedAt = value;
      continue;
    }
    const envName = key.slice(0, dot);
    const field = key.slice(dot + 1);
    if (envName !== 'production' && envName !== 'staging') continue;
    const entry = (store[envName] ??= {});
    if (field === 'ACCESS_TOKEN') entry.accessToken = value;
    else if (field === 'REFRESH_TOKEN') entry.refreshToken = value || undefined;
    else if (field === 'UPDATED_AT') entry.updatedAt = value;
    else if (field === 'PERMISSIONS') {
      entry.permissions = value.split(',').map((s) => s.trim()).filter(Boolean);
    }
    else if (field === 'FEATURES') {
      // serialized as "name:true,other:false" - matches `/organization/{id}/features` shape
      const features: FeatureMap = {};
      for (const pair of value.split(',')) {
        const [k, v] = pair.split(':').map((s) => s.trim());
        if (k) features[k] = v === 'true';
      }
      entry.features = features;
    }
  }
  if (legacy.accessToken && !store.production) {
    store.production = legacy;
  }
  return store;
}

function serializeStore(store: TokenStore): string {
  const lines: string[] = [];
  for (const envName of ['production', 'staging'] as const) {
    const entry = store[envName];
    if (!entry?.accessToken) continue;
    lines.push(`${envName}.ACCESS_TOKEN=${entry.accessToken}`);
    lines.push(`${envName}.REFRESH_TOKEN=${entry.refreshToken ?? ''}`);
    lines.push(`${envName}.UPDATED_AT=${entry.updatedAt ?? ''}`);
    if (entry.permissions && entry.permissions.length > 0) {
      lines.push(`${envName}.PERMISSIONS=${entry.permissions.join(',')}`);
    }
    if (entry.features && Object.keys(entry.features).length > 0) {
      const pairs = Object.entries(entry.features).map(([k, v]) => `${k}:${v}`);
      lines.push(`${envName}.FEATURES=${pairs.join(',')}`);
    }
  }
  return lines.join('\n') + '\n';
}

function readStore(): TokenStore {
  const path = getTokenPath();
  if (!existsSync(path)) return {};
  return parseStore(readFileSync(path, 'utf-8'));
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
  writeFileSync(path, serializeStore(store));
}

function savePermissions(env: EnvName, permissions: string[]) {
  const path = getTokenPath();
  const store = readStore();
  if (!store[env]?.accessToken) return;
  store[env] = { ...store[env], permissions };
  writeFileSync(path, serializeStore(store));
}

function saveFeatures(env: EnvName, features: FeatureMap) {
  const path = getTokenPath();
  const store = readStore();
  if (!store[env]?.accessToken) return;
  store[env] = { ...store[env], features };
  writeFileSync(path, serializeStore(store));
}

// Remove all persisted state for a single env (tokens, refresh, permissions,
// features). Other envs' entries are preserved. Used by `auth logout`.
function clearTokens(env: EnvName): boolean {
  const path = getTokenPath();
  const store = readStore();
  if (!store[env]) return false;
  delete store[env];
  writeFileSync(path, serializeStore(store));
  return true;
}

// Non-hard-exiting check - unlike `loadTokens`, this lets callers that can
// tolerate missing tokens (e.g. `auth logout --all`) act on presence without
// being killed by process.exit.
function hasTokens(env: EnvName): boolean {
  const store = readStore();
  return !!store[env]?.accessToken;
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
  return new OpenBoxCoreClient({ apiUrl: coreUrl, apiKey, env: resolved });
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
