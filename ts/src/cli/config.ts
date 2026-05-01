import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { OpenBoxClient } from '../client/index.js';
import { OpenBoxCoreClient } from '../core-client/index.js';
import {
  EnvName,
  FeatureMap,
  TokenStore,
  parseTokenStore,
  serializeTokenStore,
  resolveEnv,
  resolveUrls,
  validateApiKeyFormat as generatedValidateApiKey,
} from '../env/index.js';
import { EXIT, bailWith } from './exit-codes.js';
// os-paths lives at a sub-export so React Native consumers don't pull
// Node's `os`/`path` modules through the env package's default entry.
import { resolveOsPath } from '../env/os-paths.js';

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

// Org-level X-API-Key auth lookup. Env-var override wins so CI can inject
// a key without touching disk. Returns undefined when nothing is set .
// callers (getClient) decide whether absence is fatal.
function loadApiKey(env: EnvName): string | undefined {
  const envKey = process.env.OPENBOX_BACKEND_API_KEY;
  if (envKey) return envKey;
  return readStore()[env]?.apiKey;
}

function loadPermissions(env: EnvName): string[] {
  const store = readStore();
  return store[env]?.permissions ?? [];
}

function loadFeatures(env: EnvName): FeatureMap {
  const store = readStore();
  return store[env]?.features ?? {};
}

function savePermissions(env: EnvName, permissions: string[]) {
  const path = getTokenPath();
  const store = readStore();
  if (!store[env]?.apiKey) return;
  store[env] = { ...store[env], permissions };
  writeFileSync(path, serializeTokenStore(store), { mode: 0o600 });
}

function saveFeatures(env: EnvName, features: FeatureMap) {
  const path = getTokenPath();
  const store = readStore();
  if (!store[env]?.apiKey) return;
  store[env] = { ...store[env], features };
  writeFileSync(path, serializeTokenStore(store), { mode: 0o600 });
}

function saveApiKey(env: EnvName, apiKey: string) {
  const path = getTokenPath();
  const store = readStore();
  store[env] = {
    ...(store[env] ?? {}),
    apiKey,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(path, serializeTokenStore(store), { mode: 0o600 });
}

function clearApiKey(env: EnvName): boolean {
  const path = getTokenPath();
  const store = readStore();
  const entry = store[env];
  if (!entry?.apiKey) return false;
  delete store[env];
  writeFileSync(path, serializeTokenStore(store), { mode: 0o600 });
  return true;
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
    const flag = resolved === 'production' ? '' : `--env ${resolved} `;
    console.error(`No X-API-Key found for environment '${resolved}'.`);
    console.error(`Mint one in the dashboard FE (Organization → API Keys), then:`);
    console.error(`  openbox ${flag}auth set-api-key`);
    console.error(`Or set OPENBOX_BACKEND_API_KEY=<key> in the environment.`);
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
  console.error(
    `Invalid OPENBOX_API_KEY format: must start with 'obx_live_' or 'obx_test_'.`,
  );
  if (looksLikeAgentToken) {
    console.error(
      `\nThis looks like the 'token' field from 'agent list'/'agent get'; that's NOT the runtime API key.`,
    );
    console.error(
      `The runtime API key is returned ONCE by 'agent create' (in the response body) or 'api-key rotate'.`,
    );
    console.error(
      `\nTo recover for an existing agent: openbox api-key rotate <agentId>`,
    );
    console.error(
      `(rotation invalidates the previous key; update any deployed clients).`,
    );
  } else {
    console.error(
      `\nGet a key from 'agent create' (returned once on create) or 'api-key rotate <agentId>'.`,
    );
  }
  bailWith(EXIT.AUTH);
}

function getCoreClient(env?: EnvName): OpenBoxCoreClient {
  const resolved = env ?? resolveEnv();
  const apiKey = process.env.OPENBOX_API_KEY || '';
  if (!apiKey) {
    console.error('No OPENBOX_API_KEY found. Set it in your environment.');
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
