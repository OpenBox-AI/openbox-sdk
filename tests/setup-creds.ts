// Loaded by e2e + contract projects on top of tests/setup.ts. Sets up
// everything those projects need to talk to a real backend / core,
// derived from the active OPENBOX_ENV:
//
//   OPENBOX_API_URL          ← env registry (local → :3000, prod → api.openbox.ai)
//   OPENBOX_CORE_URL         ← env registry (local → :8086, prod → core.openbox.ai)
//   OPENBOX_BACKEND_API_KEY  ← ~/.openbox/tokens (org X-API-Key, obx_key_*)
//   OPENBOX_API_KEY          ← ~/.openbox/agent-keys (e2e-agent runtime, obx_(test|live)_*)
//
// The only env var the developer should ever set by hand is
// OPENBOX_ENV. URL overrides are still honored (in case you're
// pointing at a non-default host), but they're not required: a stale
// shell export with the wrong shape (e.g. OPENBOX_API_KEY left over
// from another env, or OPENBOX_BACKEND_API_KEY pointing at a runtime
// key) is detected by prefix and overwritten from the cache rather
// than silently breaking the run.
//
// Backend and Core are different auth systems on purpose: backend is
// the human/dashboard control plane (org X-API-Key), Core is the
// agent runtime (per-agent runtime key over Bearer auth). Mobile is
// the only sanctioned JWT consumer for the backend; every other
// surface (CLI, MCP, IDE extension, hooks) reads the X-API-Key from
// ~/.openbox/tokens, so SDK e2e dogfoods the same path.
//
// Unit tests deliberately do NOT load this file: file-tokens'
// loadApiKey short-circuits on OPENBOX_BACKEND_API_KEY before reading
// any file, so an ambient key would mask the on-disk store the unit
// tests are actually exercising. Keep credential loading scoped to
// projects that need a live backend or core.

import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { parseTokenStore, resolveEnv, resolveUrls } from '../ts/src/env/index';

const E2E_AGENT_NAME = 'e2e-agent';
const RUNTIME_KEY_PREFIX = /^obx_(test|live)_/;
const BACKEND_KEY_PREFIX = /^obx_key_/;

interface AgentKeyRecord {
  agentId: string;
  agentName: string;
  runtimeKey: string;
}

function populateUrls(): void {
  // Derive API + Core URLs from OPENBOX_ENV via the spec-driven env
  // registry. resolveUrls already honors any pre-set
  // OPENBOX_API_URL / OPENBOX_CORE_URL override, so this is a pure
  // "fill in the blanks" pass — explicit overrides win, derived
  // defaults backfill.
  const env = resolveEnv();
  const urls = resolveUrls(env);
  if (!process.env.OPENBOX_API_URL && urls.apiUrl) {
    process.env.OPENBOX_API_URL = urls.apiUrl;
  }
  if (!process.env.OPENBOX_CORE_URL && urls.coreUrl) {
    process.env.OPENBOX_CORE_URL = urls.coreUrl;
  }
}

function loadBackendKey(): void {
  // If the env var is already set with the right shape, trust it
  // (CI override path). Wrong shape = stale shell export from
  // another context — overwrite rather than break the run.
  const existing = process.env.OPENBOX_BACKEND_API_KEY;
  if (existing && BACKEND_KEY_PREFIX.test(existing)) return;

  const candidates = [
    resolve(homedir(), '.openbox', 'tokens'),
    resolve(__dirname, '..', '.tokens'),
  ];
  const tokensPath = candidates.find((p) => existsSync(p));
  if (!tokensPath) return;

  const store = parseTokenStore(readFileSync(tokensPath, 'utf-8'));
  const entry = store[resolveEnv()];
  if (entry?.apiKey) {
    process.env.OPENBOX_BACKEND_API_KEY = entry.apiKey;
  }
}

function loadCoreRuntimeKey(): void {
  // Same shape-validation pattern: an OPENBOX_API_KEY that doesn't
  // start with obx_test_/obx_live_ is not a Core runtime key and
  // would 401. Overwrite from the agent-keys cache.
  const existing = process.env.OPENBOX_API_KEY;
  if (existing && RUNTIME_KEY_PREFIX.test(existing)) return;

  const keysFile = resolve(homedir(), '.openbox', 'agent-keys');
  if (!existsSync(keysFile)) return;

  const cache: Record<string, AgentKeyRecord> = JSON.parse(
    readFileSync(keysFile, 'utf-8'),
  );
  const entry = Object.values(cache).find((r) => r.agentName === E2E_AGENT_NAME);
  if (entry?.runtimeKey) {
    process.env.OPENBOX_API_KEY = entry.runtimeKey;
  }
}

populateUrls();
loadBackendKey();
loadCoreRuntimeKey();
