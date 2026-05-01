// Hand-written codec for the on-disk token store. Implements the
// TokenCodec interface declared in specs/typespec/env/main.tsp; the
// types (TokenEntry, TokenStore, FeatureMap) are imported from
// ./generated/env-bindings.ts and never redeclared here.
//
// On-disk format (one line per field, ENV.FIELD=value):
//   production.ACCESS_TOKEN=...
//   production.REFRESH_TOKEN=...
//   production.API_KEY=obx_key_...           (alternative to ACCESS_TOKEN; X-API-Key auth)
//   production.UPDATED_AT=...
//   production.PERMISSIONS=Admin,create:agent,...
//   production.FEATURES=webhooks:true,sso:false
//   staging.ACCESS_TOKEN=...
//   ...
//
// Legacy flat-format (no env prefix, e.g. just `ACCESS_TOKEN=...`) is
// parsed as `production.*` so a pre-multi-env tokens file keeps
// working until the next save rewrites it in the namespaced shape.

import type {
  EnvName,
  FeatureMap,
  TokenCodec,
  TokenEntry,
  TokenStore,
} from './generated/env-bindings.js';

export type { FeatureMap, TokenEntry, TokenStore } from './generated/env-bindings.js';

const ENV_NAMES: readonly EnvName[] = ['production', 'staging', 'local'];

function isEnvName(s: string): s is EnvName {
  return ENV_NAMES.includes(s as EnvName);
}

export const parseTokenStore: TokenCodec['parseTokenStore'] = (content) => {
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
    else if (field === 'API_KEY') entry.apiKey = value || undefined;
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
};

export const serializeTokenStore: TokenCodec['serializeTokenStore'] = (store) => {
  const lines: string[] = [];
  for (const envName of ENV_NAMES) {
    const entry = store[envName];
    // Either credential is enough to keep the entry - api-key alone is a
    // valid auth state (the X-API-Key flow has no JWT).
    if (!entry?.accessToken && !entry?.apiKey) continue;
    if (entry.accessToken) {
      lines.push(`${envName}.ACCESS_TOKEN=${entry.accessToken}`);
      lines.push(`${envName}.REFRESH_TOKEN=${entry.refreshToken ?? ''}`);
    }
    if (entry.apiKey) {
      lines.push(`${envName}.API_KEY=${entry.apiKey}`);
    }
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
};
