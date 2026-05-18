// Per-env CLI config; eliminates the "export OPENBOX_API_URL=…" pre-amble
// every time a user works in staging or any non-default env.
//
// File: <openbox-data-root>/config (per-OS, see env/os-paths.ts).
// Mode: 0o600; drift-locked by tests/unit/platform-awareness.test.ts.
//
// Format mirrors `tokens` (dotenv-style) so a human can edit it with
// any text editor. Two scopes:
//   - global    line shape: `<KEY>=<value>`           (no prefix)
//   - per-env   line shape: `<env>.<KEY>=<value>`     (prefixed by env name)
//
// Some keys are inherently global, such as OPENBOX_ENV: it controls
// which env is active, so storing it per-env is circular. Those auto-
// promote to global even if the user passed --env. Everything else
// defaults to per-env scope.
//
// Resolution order at runtime (cli/index.ts preAction hook):
//   1. process.env.<KEY>            ; explicit shell export wins.
//   2. global config                ; applied BEFORE env resolution
//                                       (so endpoint URLs and the
//                                       backcompat OPENBOX_ENV can default).
//   3. per-env config               ; applied AFTER env resolution.
//   4. spec defaults (env package)  ; built-in URLs, etc.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { resolveOsPath } from '../env/os-paths.js';
import type { EnvName } from '../env/index.js';

type Store = Record<string, string>;

/** Keys that don't make sense to scope per-env; they CONTROL env
 *  selection or apply uniformly across every env (telemetry tag,
 *  user-data root override). Setting any of these via `config set`
 *  auto-promotes to global scope regardless of --env. */
export const GLOBAL_ONLY_KEYS: ReadonlySet<string> = new Set([
  // Selects the active env. Per-env scope would be circular.
  'OPENBOX_ENV',
  // Hard override of <data-root>; can't be per-env because it IS
  // the dir the per-env files live in.
  'OPENBOX_HOME',
  // Telemetry tag identifying the calling client (claude-code, cursor,
  // runtime/mcp/<x>). Doesn't vary per env.
  'OPENBOX_CLIENT_VARIANT',
  // Public connection endpoints. These describe the two OpenBox
  // services public consumers actually call.
  'OPENBOX_API_URL',
  'OPENBOX_CORE_URL',
  // Coarse experimental gate; you toggle it for a session, not per env.
  'OPENBOX_EXPERIMENTAL_LEVEL',
]);

export type Scope = EnvName | 'global';

function getPath(): string {
  const path = resolveOsPath('config');
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return path;
}

function read(): Store {
  const path = getPath();
  if (!existsSync(path)) return {};
  const out: Store = {};
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function write(store: Store): void {
  const lines = [
    '# OpenBox CLI config; managed by `openbox config set/get/unset/list`.',
    '# Two scopes: lines without a prefix are global; lines like',
    '# `<profile>.OPENBOX_API_URL=...` are legacy debug/profile overrides.',
  ];
  for (const k of Object.keys(store).sort()) lines.push(`${k}=${store[k]}`);
  writeFileSync(getPath(), lines.join('\n') + '\n', { mode: 0o600 });
}

function compositeKey(scope: Scope, key: string): string {
  return scope === 'global' ? key : `${scope}.${key}`;
}

/** Returns the effective scope for a key; auto-promotes global-only keys. */
export function effectiveScope(requested: Scope, key: string): Scope {
  return GLOBAL_ONLY_KEYS.has(key) ? 'global' : requested;
}

/** Persist a config value. `scope` is `'global'` for keys that apply
 *  across every env, such as OPENBOX_ENV, or one of the EnvName
 *  values for per-env scope. Global-only keys auto-promote regardless
 *  of `scope`; the return value reflects what was actually used so
 *  callers can surface a "scope was promoted" notice to the user.
 *
 *  When a global-only key is written, any pre-existing per-env entry
 *  for the same key is purged (legacy migration: an earlier CLI
 *  release may have stored OPENBOX_ENV under a per-env scope, which
 *  is dead config and would shadow nothing useful). The number of
 *  purged stray entries comes back as `purged`. */
export function setConfig(
  scope: Scope,
  key: string,
  value: string,
): { scope: Scope; purged: number } {
  if (!key) throw new Error('config key cannot be empty');
  const eff = effectiveScope(scope, key);
  const store = read();
  store[compositeKey(eff, key)] = value;
  let purged = 0;
  if (eff === 'global') {
    for (const k of Object.keys(store)) {
      // any `<env>.<key>` entry for the same key is stale.
      if (k.endsWith(`.${key}`)) {
        delete store[k];
        purged++;
      }
    }
  }
  write(store);
  return { scope: eff, purged };
}

/** Look up a value previously set via setConfig; `undefined` if absent. */
export function getConfig(scope: Scope, key: string): string | undefined {
  return read()[compositeKey(effectiveScope(scope, key), key)];
}

/** Remove a config value. Returns the effective scope it was looked
 *  up under and whether it existed. */
export function unsetConfig(scope: Scope, key: string): { scope: Scope; removed: boolean } {
  const eff = effectiveScope(scope, key);
  const store = read();
  const k = compositeKey(eff, key);
  if (!(k in store)) return { scope: eff, removed: false };
  delete store[k];
  write(store);
  return { scope: eff, removed: true };
}

/** Snapshot of every value persisted at a given scope. */
export function listConfig(scope: Scope): Record<string, string> {
  const out: Record<string, string> = {};
  if (scope === 'global') {
    for (const [k, v] of Object.entries(read())) {
      if (!k.includes('.')) out[k] = v;
    }
  } else {
    const prefix = `${scope}.`;
    for (const [k, v] of Object.entries(read())) {
      if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
    }
  }
  return out;
}

/** Path lookup for callers that want to surface the location to users. */
export function configStorePath(): string {
  return getPath();
}

/**
 * Layer GLOBAL config values into `process.env` before env resolution.
 * Called from cli/index.ts's preAction hook BEFORE `resolveEnv()` so a
 * persisted `OPENBOX_ENV=staging` can actually take effect. Only fills
 * unset vars; explicit shell exports always win.
 */
export function applyGlobalConfigToProcessEnv(): void {
  const cfg = listConfig('global');
  for (const [k, v] of Object.entries(cfg)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

/**
 * Layer per-env config values into `process.env`. Called from
 * cli/index.ts's preAction hook AFTER `resolveEnv()`. Only fills unset
 * vars; explicit shell exports and global config (already applied)
 * always win.
 */
export function applyConfigToProcessEnv(env: EnvName): void {
  const cfg = listConfig(env);
  for (const [k, v] of Object.entries(cfg)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
