// Hand-written codec for the on-disk token store. Implements the
// TokenCodec interface declared in specs/typespec/env/main.tsp; the
// types (TokenEntry, TokenStore, FeatureMap) are imported from
// ./generated/env-bindings.ts and never redeclared here.
//
// On-disk format. The primary env writes with un-prefixed lines so
// the user's typical view has no env names visible:
//   ACCESS_TOKEN=...
//   REFRESH_TOKEN=...
//   API_KEY=obx_key_...                       (alternative to ACCESS_TOKEN; X-API-Key auth)
//   UPDATED_AT=...
//   PERMISSIONS=Admin,create:agent,...
//   FEATURES=webhooks:true,sso:false
//
// Override envs (anyone using `--env staging` or similar) write
// namespaced lines, since the user is explicitly opting into the
// multi-env construct:
//   staging.ACCESS_TOKEN=...
//   ...
//
// Reading accepts both shapes; un-prefixed lines map to the primary
// env. Both legacy-format files and the new flat-write are parsed
// symmetrically.

import type {
  EnvName,
  FeatureMap,
  TokenCodec,
  TokenEntry,
  TokenStore,
} from './generated/env-bindings.js';
import { ENVIRONMENTS } from './generated/env-bindings.js';

export type { FeatureMap, TokenEntry, TokenStore } from './generated/env-bindings.js';

// Derive the env name list from the spec-emitted ENVIRONMENTS table
// so a new env added in TypeSpec automatically flows here without a
// hand edit. Drift-locked: if you add an env to the spec but skip
// the codec, parseTokenStore would silently drop the new env's
// entries; deriving here removes that failure mode.
const ENV_NAMES: readonly EnvName[] = Object.keys(ENVIRONMENTS) as EnvName[];

/** The env that owns un-prefixed (flat) on-disk lines. The primary
 *  env is always the first member of the spec-emitted EnvName enum;
 *  for a single-env user this is the one and only env they ever
 *  touch, so its on-disk shape stays env-name-free. */
const PRIMARY_ENV: EnvName = ENV_NAMES[0];

function isEnvName(s: string): s is EnvName {
  return ENV_NAMES.includes(s as EnvName);
}

function applyField(entry: TokenEntry, field: string, value: string): void {
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

export const parseTokenStore: TokenCodec['parseTokenStore'] = (content) => {
  const store: TokenStore = {};
  const flat: TokenEntry = {};
  for (const line of content.split('\n')) {
    const m = line.match(/^(\w+(?:\.\w+)?)=(.*)$/);
    if (!m) continue;
    const key = m[1];
    const value = m[2];
    const dot = key.indexOf('.');
    if (dot === -1) {
      // Un-prefixed lines route to the primary env. Apply through the
      // same field setter as the prefixed branch so both shapes carry
      // the full token-entry surface.
      applyField(flat, key, value);
      continue;
    }
    const envName = key.slice(0, dot);
    const field = key.slice(dot + 1);
    if (!isEnvName(envName)) continue;
    applyField((store[envName] ??= {}), field, value);
  }
  // Flat lines belong to PRIMARY_ENV. If the file has both a flat
  // section AND an explicit `<primary>.X=...` section, the explicit
  // one wins (a user writing both is signaling override intent).
  if ((flat.accessToken || flat.apiKey) && !store[PRIMARY_ENV]) {
    store[PRIMARY_ENV] = flat;
  }
  return store;
};

export const serializeTokenStore: TokenCodec['serializeTokenStore'] = (store) => {
  const lines: string[] = [];
  for (const envName of ENV_NAMES) {
    const entry = store[envName];
    // Either credential is enough to keep the entry; api-key alone is a
    // valid auth state (the X-API-Key flow has no JWT).
    if (!entry?.accessToken && !entry?.apiKey) continue;
    // PRIMARY_ENV writes un-prefixed lines so a single-env user's
    // tokens file has no env names. Override envs keep the namespaced
    // shape - the user reaches them via --env <name> and is opting in.
    const prefix = envName === PRIMARY_ENV ? '' : `${envName}.`;
    if (entry.accessToken) {
      lines.push(`${prefix}ACCESS_TOKEN=${entry.accessToken}`);
      lines.push(`${prefix}REFRESH_TOKEN=${entry.refreshToken ?? ''}`);
    }
    if (entry.apiKey) {
      lines.push(`${prefix}API_KEY=${entry.apiKey}`);
    }
    lines.push(`${prefix}UPDATED_AT=${entry.updatedAt ?? ''}`);
    if (entry.permissions && entry.permissions.length > 0) {
      lines.push(`${prefix}PERMISSIONS=${entry.permissions.join(',')}`);
    }
    if (entry.features && Object.keys(entry.features).length > 0) {
      const pairs = Object.entries(entry.features).map(([k, v]) => `${k}:${v}`);
      lines.push(`${prefix}FEATURES=${pairs.join(',')}`);
    }
  }
  return lines.join('\n') + '\n';
};
