import type {
  FeatureMap,
  TokenCodec,
  TokenEntry,
  TokenStore,
} from './generated/env-bindings.js';

export type { FeatureMap, TokenEntry, TokenStore } from './generated/env-bindings.js';

function applyField(entry: TokenEntry, field: string, value: string): TokenEntry {
  if (field === 'ACCESS_TOKEN') return { ...entry, accessToken: value };
  if (field === 'REFRESH_TOKEN') return { ...entry, refreshToken: value || undefined };
  if (field === 'API_KEY') return { ...entry, apiKey: value || undefined };
  if (field === 'UPDATED_AT') return { ...entry, updatedAt: value };
  if (field === 'PERMISSIONS') {
    return {
      ...entry,
      permissions: value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };
  }
  if (field === 'FEATURES') {
    const features = value.split(',').reduce<FeatureMap>((acc, pair) => {
      const [key, rawValue] = pair.split(':').map((s) => s.trim());
      return key ? { ...acc, [key]: rawValue === 'true' } : acc;
    }, {});
    return { ...entry, features };
  }
  return entry;
}

export const parseTokenStore: TokenCodec['parseTokenStore'] = (content) => {
  let store: TokenStore = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^(\w+)=(.*)$/);
    if (!match) continue;
    store = applyField(store, match[1], match[2]);
  }
  return store;
};

export const serializeTokenStore: TokenCodec['serializeTokenStore'] = (store) => {
  const lines: string[] = [];
  if (store.accessToken) {
    lines.push(`ACCESS_TOKEN=${store.accessToken}`);
    lines.push(`REFRESH_TOKEN=${store.refreshToken ?? ''}`);
  }
  if (store.apiKey) lines.push(`API_KEY=${store.apiKey}`);
  if (store.accessToken || store.apiKey) lines.push(`UPDATED_AT=${store.updatedAt ?? ''}`);
  if (store.permissions && store.permissions.length > 0) {
    lines.push(`PERMISSIONS=${store.permissions.join(',')}`);
  }
  if (store.features && Object.keys(store.features).length > 0) {
    const pairs = Object.entries(store.features).map(([key, value]) => `${key}:${value}`);
    lines.push(`FEATURES=${pairs.join(',')}`);
  }
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
};
