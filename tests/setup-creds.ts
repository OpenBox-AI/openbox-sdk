// Loaded by e2e + contract projects on top of tests/setup.ts. Sets up
// what those projects need to talk to a real backend / core: two URLs
// and two credentials. Nothing else.
//
// Defaults target the local stack. To run against a different host,
// set OPENBOX_API_URL / OPENBOX_CORE_URL directly. Credentials come
// from the developer's existing on-disk caches; pre-set credential
// env vars are honored (CI override path) but their shape is
// validated; a stale shell export with the wrong prefix is detected
// and overwritten from the cache rather than silently 401'ing the run.
//
// Backend and Core are different auth systems on purpose: backend is
// the human/dashboard control plane (org X-API-Key over header
// `X-API-Key`), Core is the agent runtime (per-agent runtime key
// over Bearer auth). Mobile is the only sanctioned JWT consumer for
// the backend; every other surface (CLI, MCP, IDE extension, hooks)
// reads the X-API-Key from ~/.openbox/tokens, so SDK e2e dogfoods
// the same path.
//
// Unit tests deliberately do NOT load this file: file-tokens'
// loadApiKey short-circuits on OPENBOX_BACKEND_API_KEY before reading
// any file, so an ambient key would mask the on-disk store the unit
// tests are actually exercising. Keep credential loading scoped to
// projects that need a live backend or core.

import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { parseTokenStore } from '../ts/src/env/index';

const DEFAULT_API_URL = 'http://localhost:3000';
const DEFAULT_CORE_URL = 'http://localhost:8086';
const UNIT_DEFAULT_API_URL = 'http://localhost:18080';
const UNIT_DEFAULT_CORE_URL = 'http://localhost:18081';
const E2E_AGENT_NAME = 'e2e-agent';
const RUNTIME_KEY_PREFIX = /^obx_(test|live)_/;
const BACKEND_KEY_PREFIX = /^obx_key_/;

interface AgentKeyRecord {
  agentId: string;
  agentName: string;
  runtimeKey: string;
}

function populateUrls(): void {
  if (process.env.OPENBOX_API_URL_OVERRIDE) {
    process.env.OPENBOX_API_URL = process.env.OPENBOX_API_URL_OVERRIDE;
    delete process.env.OPENBOX_API_URL_OVERRIDE;
  }
  if (process.env.OPENBOX_CORE_URL_OVERRIDE) {
    process.env.OPENBOX_CORE_URL = process.env.OPENBOX_CORE_URL_OVERRIDE;
    delete process.env.OPENBOX_CORE_URL_OVERRIDE;
  }
  if (!process.env.OPENBOX_API_URL || process.env.OPENBOX_API_URL === UNIT_DEFAULT_API_URL) {
    process.env.OPENBOX_API_URL = DEFAULT_API_URL;
  }
  if (!process.env.OPENBOX_CORE_URL || process.env.OPENBOX_CORE_URL === UNIT_DEFAULT_CORE_URL) {
    process.env.OPENBOX_CORE_URL = DEFAULT_CORE_URL;
  }
}

function unlockExperimentalCli(): void {
  // The cli-commands suite shells out to the openbox binary as a
  // subprocess. The CLI gates org / team / behavior / etc. behind
  // --experimental to prevent accidental use; e2e is exactly the
  // case the gate is designed to allow. Unlock at the parent-process
  // level so spawned subprocesses inherit the level rather than
  // threading --experimental through every runCli call.
  if (!process.env.OPENBOX_EXPERIMENTAL_LEVEL) {
    process.env.OPENBOX_EXPERIMENTAL_LEVEL = 'experimental';
  }
}

function loadBackendKey(): void {
  // If the env var is already set with the right shape, trust it
  // (CI override path). Wrong shape = stale shell export from
  // another context; overwrite rather than break the run.
  const existing =
    process.env.OPENBOX_BACKEND_API_KEY ||
    process.env.OPENBOX_BACKEND_API_KEY_OVERRIDE;
  if (existing && BACKEND_KEY_PREFIX.test(existing)) {
    process.env.OPENBOX_BACKEND_API_KEY = existing;
    delete process.env.OPENBOX_BACKEND_API_KEY_OVERRIDE;
    return;
  }
  if (process.env.OPENBOX_BACKEND_API_KEY_OVERRIDE) {
    delete process.env.OPENBOX_BACKEND_API_KEY_OVERRIDE;
  }

  const candidates = [
    resolve(homedir(), '.openbox', 'tokens'),
    resolve(__dirname, '..', '.tokens'),
  ];
  const tokensPath = candidates.find((p) => existsSync(p));
  if (!tokensPath) return;

  const store = parseTokenStore(readFileSync(tokensPath, 'utf-8'));
  if (store.apiKey && BACKEND_KEY_PREFIX.test(store.apiKey)) {
    process.env.OPENBOX_BACKEND_API_KEY = store.apiKey;
  }
}

function loadCoreRuntimeKey(): void {
  // Same shape-validation pattern: an OPENBOX_API_KEY that doesn't
  // start with obx_test_/obx_live_ is not a Core runtime key and
  // would 401. Overwrite from the agent-keys cache.
  const existing =
    process.env.OPENBOX_API_KEY ||
    process.env.OPENBOX_API_KEY_OVERRIDE;
  if (existing && RUNTIME_KEY_PREFIX.test(existing)) {
    process.env.OPENBOX_API_KEY = existing;
    delete process.env.OPENBOX_API_KEY_OVERRIDE;
    return;
  }
  if (process.env.OPENBOX_API_KEY_OVERRIDE) {
    delete process.env.OPENBOX_API_KEY_OVERRIDE;
  }

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

async function populateOrgId(): Promise<void> {
  // The active orgId differs per backend host (localhost stack ≠ prod
  // ≠ staging) and the e2e suite addresses many endpoints by
  // `/organization/{orgId}/...`. Rather than derive it from the URL
  //; which would re-introduce the env concept by another name; ask
  // the backend itself: /auth/profile returns the orgId for the
  // authenticated principal. Single source of truth, lives on the
  // server we're already talking to.
  if (process.env.OPENBOX_ORG_ID) return;
  const apiUrl = process.env.OPENBOX_API_URL;
  const apiKey = process.env.OPENBOX_BACKEND_API_KEY;
  if (!apiUrl || !apiKey) return;
  try {
    const res = await fetch(`${apiUrl}/auth/profile`, {
      headers: { 'X-API-Key': apiKey },
    });
    if (!res.ok) return;
    const body = (await res.json()) as { data?: { orgId?: string } };
    if (body?.data?.orgId) process.env.OPENBOX_ORG_ID = body.data.orgId;
  } catch {
    /* best-effort; tests requiring orgId will surface a clear error */
  }
}

populateUrls();
unlockExperimentalCli();
loadBackendKey();
loadCoreRuntimeKey();
await populateOrgId();
