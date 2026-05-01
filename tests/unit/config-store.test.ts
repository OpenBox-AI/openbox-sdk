// Unit coverage for cli/config-store.ts. The store backs the
// `openbox config set/get/unset/list` commands and is layered into
// process.env on every CLI command via applyConfigToProcessEnv.
//
// File-mode safety is pinned by tests/unit/platform-awareness;
// here we exercise behavior: round-trip, per-env scoping, applyConfig
// only fills unset vars (shell exports always win), missing-file
// safety, corruption recovery.

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, existsSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sandbox = mkdtempSync(join(tmpdir(), 'openbox-config-'));
const originalHome = process.env.OPENBOX_HOME;
process.env.OPENBOX_HOME = sandbox;

const {
  setConfig,
  getConfig,
  unsetConfig,
  listConfig,
  configStorePath,
  applyConfigToProcessEnv,
} = await import('../../ts/src/cli/config-store.js');

afterAll(() => {
  if (originalHome === undefined) delete process.env.OPENBOX_HOME;
  else process.env.OPENBOX_HOME = originalHome;
  rmSync(sandbox, { recursive: true, force: true });
});

beforeEach(() => {
  const path = configStorePath();
  if (existsSync(path)) rmSync(path);
});

describe('config-store', () => {
  it('round-trips a value within one env', () => {
    setConfig('staging', 'OPENBOX_API_URL', 'https://staging.example');
    expect(getConfig('staging', 'OPENBOX_API_URL')).toBe('https://staging.example');
  });

  it('returns undefined for unknown keys', () => {
    expect(getConfig('staging', 'NEVER_SET')).toBeUndefined();
  });

  it('returns undefined when the file is missing', () => {
    expect(existsSync(configStorePath())).toBe(false);
    expect(getConfig('production', 'ANY')).toBeUndefined();
  });

  it('scopes values per env (no cross-env leak)', () => {
    setConfig('staging', 'OPENBOX_API_URL', 'https://staging.example');
    setConfig('production', 'OPENBOX_API_URL', 'https://prod.example');
    expect(getConfig('staging', 'OPENBOX_API_URL')).toBe('https://staging.example');
    expect(getConfig('production', 'OPENBOX_API_URL')).toBe('https://prod.example');
  });

  it('writes the file at mode 0o600', () => {
    setConfig('staging', 'X', 'y');
    expect(statSync(configStorePath()).mode & 0o777).toBe(0o600);
  });

  it("list returns only the active env's keys, stripped", () => {
    setConfig('staging', 'A', '1');
    setConfig('staging', 'B', '2');
    setConfig('production', 'A', '3');
    expect(listConfig('staging')).toEqual({ A: '1', B: '2' });
    expect(listConfig('production')).toEqual({ A: '3' });
  });

  it('unset removes a value (returns removed=true); no-op returns false', () => {
    setConfig('staging', 'A', '1');
    const r1 = unsetConfig('staging', 'A');
    expect(r1.removed).toBe(true);
    expect(r1.scope).toBe('staging');
    expect(getConfig('staging', 'A')).toBeUndefined();
    const r2 = unsetConfig('staging', 'A');
    expect(r2.removed).toBe(false);
  });

  it('rejects empty keys', () => {
    expect(() => setConfig('staging', '', 'value')).toThrow(/key/i);
  });

  it('applyConfigToProcessEnv populates only unset vars', () => {
    setConfig('staging', 'OPENBOX_API_URL', 'https://from-config.example');
    setConfig('staging', 'OPENBOX_CORE_URL', 'https://core-from-config.example');
    delete process.env.OPENBOX_API_URL;
    process.env.OPENBOX_CORE_URL = 'https://shell-export.example'; // already set

    applyConfigToProcessEnv('staging');

    expect(process.env.OPENBOX_API_URL).toBe('https://from-config.example');
    // Shell export wins; config never overrides an explicit env var.
    expect(process.env.OPENBOX_CORE_URL).toBe('https://shell-export.example');

    delete process.env.OPENBOX_API_URL;
    delete process.env.OPENBOX_CORE_URL;
  });

  it('applyConfigToProcessEnv respects env scoping', () => {
    setConfig('staging', 'OPENBOX_API_URL', 'https://stg.example');
    setConfig('production', 'OPENBOX_API_URL', 'https://prod.example');
    delete process.env.OPENBOX_API_URL;

    applyConfigToProcessEnv('production');
    expect(process.env.OPENBOX_API_URL).toBe('https://prod.example');

    delete process.env.OPENBOX_API_URL;
  });

  it('tolerates a corrupt config file (returns empty store)', () => {
    writeFileSync(configStorePath(), 'this is not\nvalid format $$$$', { mode: 0o600 });
    expect(listConfig('staging')).toEqual({});
    setConfig('staging', 'X', '1');
    expect(getConfig('staging', 'X')).toBe('1');
  });

  it('configStorePath() lives under OPENBOX_HOME', () => {
    expect(configStorePath().startsWith(sandbox)).toBe(true);
    expect(configStorePath().endsWith('config')).toBe(true);
  });

  // --- global scope + auto-promotion -------------------------------

  it('global scope: round-trips with no env prefix on disk', () => {
    setConfig('global', 'OPENBOX_CLIENT_VARIANT', 'claude-code');
    expect(getConfig('global', 'OPENBOX_CLIENT_VARIANT')).toBe('claude-code');
    // Asserting the on-disk shape: global lines have NO `<env>.` prefix.
    const raw = readFileSyncFromStore();
    expect(raw).toMatch(/^OPENBOX_CLIENT_VARIANT=claude-code$/m);
    expect(raw).not.toMatch(/^staging\.OPENBOX_CLIENT_VARIANT/m);
  });

  it('OPENBOX_ENV auto-promotes to global even when caller passes per-env scope', () => {
    const result = setConfig('staging', 'OPENBOX_ENV', 'staging');
    expect(result.scope).toBe('global');
    // It must NOT be readable under staging scope (would defeat the
    // promotion and leave a dangling line).
    expect(getConfig('staging', 'OPENBOX_ENV')).toBe('staging'); // still found via auto-promote on read
    // Verify on-disk: only ONE line for OPENBOX_ENV, with no prefix.
    const raw = readFileSyncFromStore();
    expect(raw).toMatch(/^OPENBOX_ENV=staging$/m);
    expect(raw).not.toMatch(/^staging\.OPENBOX_ENV=/m);
    expect(raw).not.toMatch(/^production\.OPENBOX_ENV=/m);
  });

  it('OPENBOX_HOME, OPENBOX_CLIENT_VARIANT, OPENBOX_EXPERIMENTAL_LEVEL also auto-promote', () => {
    for (const k of ['OPENBOX_HOME', 'OPENBOX_CLIENT_VARIANT', 'OPENBOX_EXPERIMENTAL_LEVEL']) {
      const r = setConfig('production', k, 'value');
      expect(r.scope, `${k} should auto-promote`).toBe('global');
    }
  });

  it('list("global") returns only un-prefixed entries', () => {
    setConfig('global', 'OPENBOX_CLIENT_VARIANT', 'claude-code');
    setConfig('staging', 'OPENBOX_API_URL', 'https://stg');
    setConfig('production', 'OPENBOX_API_URL', 'https://prd');
    expect(listConfig('global')).toEqual({ OPENBOX_CLIENT_VARIANT: 'claude-code' });
    expect(listConfig('staging')).toEqual({ OPENBOX_API_URL: 'https://stg' });
  });

  it('applyGlobalConfigToProcessEnv lifts global-scope keys before env resolution', async () => {
    const { applyGlobalConfigToProcessEnv } = await import(
      '../../ts/src/cli/config-store.js'
    );
    setConfig('global', 'OPENBOX_CLIENT_VARIANT', 'from-global-config');
    delete process.env.OPENBOX_CLIENT_VARIANT;
    applyGlobalConfigToProcessEnv();
    expect(process.env.OPENBOX_CLIENT_VARIANT).toBe('from-global-config');
    delete process.env.OPENBOX_CLIENT_VARIANT;
  });

  it('global apply respects shell exports (no override)', async () => {
    const { applyGlobalConfigToProcessEnv } = await import(
      '../../ts/src/cli/config-store.js'
    );
    setConfig('global', 'OPENBOX_CLIENT_VARIANT', 'from-config');
    process.env.OPENBOX_CLIENT_VARIANT = 'from-shell';
    applyGlobalConfigToProcessEnv();
    expect(process.env.OPENBOX_CLIENT_VARIANT).toBe('from-shell');
    delete process.env.OPENBOX_CLIENT_VARIANT;
  });

  it('per-env apply does NOT pull from global', () => {
    setConfig('global', 'OPENBOX_API_URL', 'https://global.example');
    delete process.env.OPENBOX_API_URL;
    applyConfigToProcessEnv('staging');
    // Per-env apply only loads the staging prefix; global URL must
    // not leak into the per-env apply layer (that's why we have the
    // separate applyGlobalConfigToProcessEnv).
    expect(process.env.OPENBOX_API_URL).toBeUndefined();
  });
});

import { readFileSync as readFileSyncImport } from 'node:fs';
function readFileSyncFromStore(): string {
  return readFileSyncImport(configStorePath(), 'utf-8');
}
