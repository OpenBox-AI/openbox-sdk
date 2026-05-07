// Loaded by e2e + contract projects on top of tests/setup.ts. Populates
// the credentials those projects need from on-disk caches:
//
//   OPENBOX_BACKEND_API_KEY  ← ~/.openbox/tokens (or repo-local .tokens)
//                              for the active OPENBOX_ENV. Backend +
//                              dashboard surfaces. Org-scoped, X-API-Key.
//   OPENBOX_API_KEY          ← ~/.openbox/agent-keys, canonical
//                              `e2e-agent` runtime key. Core surface.
//                              Per-agent, Bearer auth.
//
// Backend and Core are different auth systems on purpose: one is the
// human/dashboard control plane, the other is the agent runtime.
// Mobile is the only sanctioned JWT consumer for the backend; every
// other surface (CLI, MCP, IDE extension, hooks) reads the X-API-Key
// from ~/.openbox/tokens, so SDK e2e dogfoods the same path.
//
// Unit tests deliberately do NOT load this file: file-tokens'
// loadApiKey short-circuits on OPENBOX_BACKEND_API_KEY before reading
// any file, so an ambient key would mask the on-disk store the unit
// tests are actually exercising. Keep credential loading scoped to
// projects that need a live backend or core.

import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { parseTokenStore, resolveEnv } from '../ts/src/env/index';

const E2E_AGENT_NAME = 'e2e-agent';

interface AgentKeyRecord {
  agentId: string;
  agentName: string;
  runtimeKey: string;
}

function loadBackendKey(): void {
  const candidates = [
    resolve(homedir(), '.openbox', 'tokens'),
    resolve(__dirname, '..', '.tokens'),
  ];
  const tokensPath = candidates.find((p) => existsSync(p));
  if (!tokensPath) return;

  const store = parseTokenStore(readFileSync(tokensPath, 'utf-8'));
  const entry = store[resolveEnv()];
  if (entry?.apiKey && !process.env.OPENBOX_BACKEND_API_KEY) {
    process.env.OPENBOX_BACKEND_API_KEY = entry.apiKey;
  }
}

function loadCoreRuntimeKey(): void {
  if (process.env.OPENBOX_API_KEY) return;
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

loadBackendKey();
loadCoreRuntimeKey();
