// Per-agent runtime-key cache. Populated by the CLI's
// `highlightRuntimeKey` post-callback (fires on `agent create` +
// `api-key rotate`); read by both `openbox api-key recall` (the CLI
// recovery path) and the MCP server's resolveApiKey (so MCP-driven
// governance calls can find a runtime key without the caller re-
// pasting it). Lives under runtime/_shared/ because both surfaces
// depend on it; sibling to install.ts and session-store.ts.
//
// File: <openbox-data-root>/agent-keys (per-OS, see env/os-paths.ts).
// Mode: 0o600; drift-locked by tests/unit/platform-awareness.test.ts.
//
// Format: a thin JSON object mapping agentId → record. Plain JSON
// (not the .env-style token store) because the caller is always the
// CLI in the same env; there's no multi-env layering to support.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { resolveOsPath } from '../../env/os-paths.js';

export interface AgentKeyRecord {
  agentId: string;
  agentName?: string;
  runtimeKey: string;
  /** ISO-8601 timestamp the key was captured. */
  recordedAt: string;
}

type Store = Record<string, AgentKeyRecord>;

function getPath(): string {
  const path = resolveOsPath('agent-keys' as never);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return path;
}

function read(): Store {
  const path = getPath();
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    return parsed && typeof parsed === 'object' ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  writeFileSync(getPath(), JSON.stringify(store, null, 2) + '\n', { mode: 0o600 });
}

/** Persist the runtime key for an agent. Last-write-wins on agentId. */
export function recordAgentKey(agentId: string, runtimeKey: string, agentName?: string): void {
  if (!agentId || !runtimeKey) return;
  if (!runtimeKey.startsWith('obx_live_') && !runtimeKey.startsWith('obx_test_')) return;
  const store = read();
  store[agentId] = {
    agentId,
    agentName,
    runtimeKey,
    recordedAt: new Date().toISOString(),
  };
  write(store);
}

/** Look up a previously-recorded runtime key. */
export function recallAgentKey(agentId: string): AgentKeyRecord | null {
  return read()[agentId] ?? null;
}

/** Path lookup for callers that want to surface the location to users. */
export function agentKeysPath(): string {
  return getPath();
}
