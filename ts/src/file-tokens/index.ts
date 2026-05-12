// File-backed token store. Used by the CLI, the VS Code / Cursor
// extension, and any other Node consumer that wants to share auth
// state with the rest of the OpenBox toolchain.
//
// On-disk shape is the env-namespaced key=value text format defined
// by `openbox-sdk/env`'s `parseTokenStore` / `serializeTokenStore`.
// This module is the file-IO + path-resolution layer on top.
//
// Mobile / browser consumers should NOT import this — they have no
// filesystem and use `openbox-sdk/client-factory` with a
// platform-specific `getApiKey` callback instead.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  parseTokenStore,
  serializeTokenStore,
  type EnvName,
  type TokenStore,
} from '../env/index.js';
import { resolveOsPath } from '../env/os-paths.js';

/**
 * Resolve the active token-store path. A `.tokens` file in the cwd
 * wins over the per-OS user-data path; the cwd file is a CI / dev-loop
 * convenience and the user-data path is the production case.
 *
 * Side effect: creates the parent directory of the user-data path
 * when it doesn't exist, so callers can read/write without a
 * pre-flight `mkdirSync`.
 */
export function getTokenPath(): string {
  const projectTokens = resolve(process.cwd(), '.tokens');
  if (existsSync(projectTokens)) return projectTokens;
  const path = resolveOsPath('tokens');
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return path;
}

/** Read + parse the active token store. Returns an empty store
 *  (not undefined) when the file doesn't exist, so callers can
 *  always do `store[env]?.apiKey` safely. */
export function readTokenStore(): TokenStore {
  const path = getTokenPath();
  if (!existsSync(path)) return {};
  return parseTokenStore(readFileSync(path, 'utf-8'));
}

/**
 * Look up the X-API-Key for an environment. `OPENBOX_BACKEND_API_KEY`
 * env var wins over the file so CI can inject a key without touching
 * disk. Returns undefined when nothing is set; callers decide whether
 * absence is fatal.
 */
export function loadApiKey(env: EnvName): string | undefined {
  const envKey = process.env.OPENBOX_BACKEND_API_KEY;
  if (envKey) return envKey;
  return readTokenStore()[env]?.apiKey;
}

/** Persist the X-API-Key for `env`. Mode 0o600 so the file isn't
 *  world-readable on multi-user machines. */
export function saveApiKey(env: EnvName, apiKey: string): void {
  const path = getTokenPath();
  const store = readTokenStore();
  store[env] = {
    ...(store[env] ?? {}),
    apiKey,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(path, serializeTokenStore(store), { mode: 0o600 });
}

/** Remove the X-API-Key for `env`. Returns false when nothing was
 *  removed (idempotent caller never asks "was anything actually
 *  there?"). */
export function clearApiKey(env: EnvName): boolean {
  const path = getTokenPath();
  const store = readTokenStore();
  const entry = store[env];
  if (!entry?.apiKey) return false;
  delete store[env];
  writeFileSync(path, serializeTokenStore(store), { mode: 0o600 });
  return true;
}

/** True when `env` has a stored X-API-Key (or one in the env-var
 *  override). Useful for gating UI affordances without forcing the
 *  caller to pull the actual key into memory. */
export function hasApiKey(env: EnvName): boolean {
  return loadApiKey(env) !== undefined;
}

// Per-agent runtime-key cache. Lives alongside the token store
// because both surfaces are file-backed credentials with the same
// lifecycle.
export {
  recordAgentKey,
  recallAgentKey,
  agentKeysPath,
  type AgentKeyRecord,
} from './agent-keys.js';
