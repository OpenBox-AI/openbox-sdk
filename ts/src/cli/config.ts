import { writeFileSync } from 'fs';
import { OpenBoxClient } from '../client/index.js';
import { OpenBoxCoreClient } from '../core-client/index.js';
import {
  EnvName,
  FeatureMap,
  serializeTokenStore,
  resolveEnv,
  resolveUrls,
  validateApiKeyFormat as generatedValidateApiKey,
} from '../env/index.js';
import { EXIT, bailWith } from './exit-codes.js';
import { error } from './output.js';
// File-backed X-API-Key store; canonical for every Node consumer
// (CLI, extension). Mobile uses its own keychain-backed source via
// `openbox-sdk/client-factory`'s `getApiKey` callback.
import {
  getTokenPath,
  readTokenStore,
  loadApiKey,
  saveApiKey,
  clearApiKey,
} from '../file-tokens/index.js';

export type { FeatureMap };

function loadPermissions(env: EnvName): string[] {
  const store = readTokenStore();
  return store[env]?.permissions ?? [];
}

function loadFeatures(env: EnvName): FeatureMap {
  const store = readTokenStore();
  return store[env]?.features ?? {};
}

function savePermissions(env: EnvName, permissions: string[]) {
  const path = getTokenPath();
  const store = readTokenStore();
  if (!store[env]?.apiKey) return;
  store[env] = { ...store[env], permissions };
  writeFileSync(path, serializeTokenStore(store), { mode: 0o600 });
}

function saveFeatures(env: EnvName, features: FeatureMap) {
  const path = getTokenPath();
  const store = readTokenStore();
  if (!store[env]?.apiKey) return;
  store[env] = { ...store[env], features };
  writeFileSync(path, serializeTokenStore(store), { mode: 0o600 });
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
  const { apiUrl } = resolveUrls(resolved);
  const apiKey = loadApiKey(resolved);
  if (!apiKey) {
    error('no X-API-Key configured.', {
      fix: 'mint one in the dashboard FE (Organization → API Keys), then run `openbox auth set-api-key`. or set OPENBOX_BACKEND_API_KEY=<key> in the environment.',
    });
    bailWith(EXIT.AUTH);
  }
  const cachedPerms = loadPermissions(resolved);
  return new OpenBoxClient({
    apiUrl,
    env: resolved,
    apiKey,
    permissions: cachedPerms.length > 0 ? cachedPerms : undefined,
    timeoutMs: resolveTimeoutMs(),
  });
}

// Core only accepts API keys that start with `obx_live_` (production) or
// `obx_test_` (test/staging). The most common misuse is to grab the
// `token` field from `agent list`/`agent get` and pass it as
// OPENBOX_API_KEY; that's an internal attestation token, not the
// runtime key. Catching it here gives a clear hint pointing at the
// right field, instead of letting core return a generic 500
// ("invalid API key format. Expected format: obx_live_... or obx_test_...").
function validateAgentRuntimeKeyFormat(key: string): void {
  // Canonical regex lives in specs/typespec/env/main.tsp via @token_format.
  // We just call the generated checker; the wrapper below adds CLI-flavored
  // hints that don't belong in the spec.
  const result = generatedValidateApiKey(key);
  if (result === true) return;
  const looksLikeAgentToken = /^[a-f0-9]{32,}$/i.test(key);
  const hint = looksLikeAgentToken
    ? "this looks like the 'token' field from 'agent list'/'agent get'; that's NOT the runtime API key. the runtime API key is returned ONCE by 'agent create' or 'api-key rotate'. to recover: `openbox api-key rotate <agentId>` (invalidates the previous key)."
    : "get a key from 'agent create' (returned once on create) or `openbox api-key rotate <agentId>`.";
  error(
    "invalid OPENBOX_API_KEY format: must start with 'obx_live_' or 'obx_test_'.",
    { hint },
  );
  bailWith(EXIT.AUTH);
}

function getCoreClient(env?: EnvName): OpenBoxCoreClient {
  const resolved = env ?? resolveEnv();
  const apiKey = process.env.OPENBOX_API_KEY || '';
  if (!apiKey) {
    error('no OPENBOX_API_KEY found.', {
      fix: 'set it in your environment.',
    });
    bailWith(EXIT.AUTH);
  }
  validateAgentRuntimeKeyFormat(apiKey);
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
  savePermissions,
  saveFeatures,
  saveApiKey,
  clearApiKey,
  loadApiKey,
  loadPermissions,
  loadFeatures,
  getTokenPath,
};
