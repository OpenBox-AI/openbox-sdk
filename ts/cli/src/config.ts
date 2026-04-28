import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { OpenBoxClient } from 'openbox-sdk/client';
import { OpenBoxCoreClient } from 'openbox-sdk/core-client';
import {
  EnvName,
  FeatureMap,
  TokenStore,
  parseTokenStore,
  serializeTokenStore,
  resolveEnv,
  resolveUrls,
  validateApiKeyFormat as generatedValidateApiKey,
} from 'openbox-sdk/env';
// os-paths lives at a sub-export so React Native consumers don't pull
// Node's `os`/`path` modules through the env package's default entry.
import { resolveOsPath } from 'openbox-sdk/env/os-paths';

// Per-OS user-data path comes from `openbox-sdk/env`'s spec-driven
// `resolveOsPath` (Linux/macOS = ~/.openbox/tokens, Windows =
// %APPDATA%\openbox\tokens, override via OPENBOX_HOME). The optional
// `.tokens` file in the cwd is a CI/dev-loop convenience that wins
// over the user-data path; the user-data path is the production case.
function getTokenPath(): string {
  const projectTokens = resolve(process.cwd(), '.tokens');
  if (existsSync(projectTokens)) return projectTokens;
  const path = resolveOsPath('tokens');
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return path;
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
// Falsy / non-finite values fall through to the SDK default (35_000),
// which sits 5s above core's 30s WorkflowExecutionTimeout so a
// workflow timeout surfaces as the server's 500 instead of an
// AbortController cancel.
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
  // Prime the wrapper's permission pre-flight from the on-disk cache
  // populated at login (and refreshed on `auth refresh`). When the
  // cache is empty (fresh install before login completes), the field
  // stays undefined and pre-flight degrades to a no-op - server still
  // returns 403, just no client-side short-circuit.
  const cachedPerms = loadPermissions(resolved);
  return new OpenBoxClient({
    apiUrl,
    env: resolved,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    permissions: cachedPerms.length > 0 ? cachedPerms : undefined,
    timeoutMs: resolveTimeoutMs(),
    onTokenRefresh: (newTokens) => {
      saveTokens(resolved, newTokens.accessToken, newTokens.refreshToken);
      console.error('[token refreshed]');
    },
  });
}

// Core only accepts API keys that start with `obx_live_` (production) or
// `obx_test_` (test/staging). The most common misuse is to grab the
// `token` field from `agent list`/`agent get` and pass it as
// OPENBOX_API_KEY - that's an internal attestation token, not the
// runtime key. Catching it here gives a clear hint pointing at the
// right field, instead of letting core return a generic 500
// ("invalid API key format. Expected format: obx_live_... or obx_test_...").
function validateApiKeyFormat(key: string): void {
  // Canonical regex lives in specs/typespec/env/main.tsp via @token_format.
  // We just call the generated checker; the wrapper below adds CLI-flavored
  // hints that don't belong in the spec.
  const result = generatedValidateApiKey(key);
  if (result === true) return;
  const looksLikeAgentToken = /^[a-f0-9]{32,}$/i.test(key);
  console.error(
    `Invalid OPENBOX_API_KEY format: must start with 'obx_live_' or 'obx_test_'.`,
  );
  if (looksLikeAgentToken) {
    console.error(
      `\nThis looks like the 'token' field from 'agent list'/'agent get' - that's NOT the runtime API key.`,
    );
    console.error(
      `The runtime API key is returned ONCE by 'agent create' (in the response body) or 'api-key rotate'.`,
    );
    console.error(
      `\nTo recover for an existing agent: openbox api-key rotate <agentId>`,
    );
    console.error(
      `(rotation invalidates the previous key - update any deployed clients).`,
    );
  } else {
    console.error(
      `\nGet a key from 'agent create' (returned once on create) or 'api-key rotate <agentId>'.`,
    );
  }
  process.exit(1);
}

function getCoreClient(env?: EnvName): OpenBoxCoreClient {
  const resolved = env ?? resolveEnv();
  const apiKey = process.env.OPENBOX_API_KEY || '';
  if (!apiKey) {
    console.error('No OPENBOX_API_KEY found. Set it in your environment.');
    process.exit(1);
  }
  validateApiKeyFormat(apiKey);
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
