// Format codec for the env-namespaced token store. Pure string in / string
// out so any backend (fs, SecureStore, chrome.storage) can wrap it.
//
// On-disk format (one line per field, ENV.FIELD=value):
//   production.ACCESS_TOKEN=...
//   production.REFRESH_TOKEN=...
//   production.UPDATED_AT=...
//   production.PERMISSIONS=Admin,create:agent,...
//   production.FEATURES=webhooks:true,sso:false
//   staging.ACCESS_TOKEN=...
//   ...
//
// Legacy flat-format (no env prefix, e.g. just `ACCESS_TOKEN=...`) is parsed
// as `production.*` so a pre-multi-env tokens file keeps working until the
// next save rewrites it in the namespaced shape.

import type { EnvName } from './environments.js';

export type FeatureMap = Record<string, boolean>;

export interface TokenEntry {
  accessToken?: string;
  refreshToken?: string;
  updatedAt?: string;
  permissions?: string[];
  features?: FeatureMap;
}

export type TokenStore = Partial<Record<EnvName, TokenEntry>>;

const ENV_NAMES: readonly EnvName[] = ['production', 'staging', 'local'];

function isEnvName(s: string): s is EnvName {
  return ENV_NAMES.includes(s as EnvName);
}

export function parseTokenStore(content: string): TokenStore {
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
    if (!isEnvName(envName)) continue;
    const entry = (store[envName] ??= {});
    if (field === 'ACCESS_TOKEN') entry.accessToken = value;
    else if (field === 'REFRESH_TOKEN') entry.refreshToken = value || undefined;
    else if (field === 'UPDATED_AT') entry.updatedAt = value;
    else if (field === 'PERMISSIONS') {
      entry.permissions = value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (field === 'FEATURES') {
      const features: FeatureMap = {};
      for (const pair of value.split(',')) {
        const [k, v] = pair.split(':').map((s) => s.trim());
        if (k) features[k] = v === 'true';
      }
      entry.features = features;
    }
  }
  // Legacy un-prefixed entries belong to production by convention. If
  // production already has explicit entries, the namespaced entries win
  // (legacy is a fallback, not an override).
  if (legacy.accessToken && !store.production) {
    store.production = legacy;
  }
  return store;
}

export function serializeTokenStore(store: TokenStore): string {
  const lines: string[] = [];
  for (const envName of ENV_NAMES) {
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
