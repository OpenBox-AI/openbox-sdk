// Coverage for ts/src/cli/config.ts. The CLI config module persists
// per-env tokens / permissions / features to ~/.openbox/tokens. Tests
// drive each public helper end-to-end against a sandboxed token-store
// path so the actual write/read/parse flow is exercised.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;
let originalHome: string | undefined;
let originalCwd: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'openbox-cli-config-'));
  // Two layers of indirection: OPENBOX_HOME forces resolveOsPath into
  // the sandbox, AND we cd into a fresh dir so any cwd-local `.tokens`
  // (the bootstrap-admin convenience symlink) doesn't intercept.
  originalHome = process.env.OPENBOX_HOME;
  process.env.OPENBOX_HOME = dir;
  originalCwd = process.cwd();
  process.chdir(dir);
});
afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome !== undefined) process.env.OPENBOX_HOME = originalHome;
  else delete process.env.OPENBOX_HOME;
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

describe('cli/config - token store CRUD', () => {
  it('saveTokens writes a 0o600 file the load can round-trip', async () => {
    const cfg = await import('../../ts/src/cli/config');
    cfg.saveTokens('local', 'ax', 'rx', ['Admin']);
    const path = cfg.getTokenPath();
    expect(existsSync(path)).toBe(true);
    // 0o600 = -rw-------. Mask off file-type bits.
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(cfg.hasTokens('local')).toBe(true);
    expect(cfg.hasTokens('production')).toBe(false);
  });

  it('savePermissions / saveFeatures update without clobbering tokens', async () => {
    const cfg = await import('../../ts/src/cli/config');
    cfg.saveTokens('local', 'ax', 'rx');
    cfg.savePermissions('local', ['read:agent', 'create:agent']);
    cfg.saveFeatures('local', { webhooks: true, sso: false });
    expect(cfg.loadPermissions('local')).toEqual(['read:agent', 'create:agent']);
    expect(cfg.loadFeatures('local')).toEqual({ webhooks: true, sso: false });
    expect(cfg.hasTokens('local')).toBe(true);
  });

  it('clearTokens removes the named env entry but preserves others', async () => {
    const cfg = await import('../../ts/src/cli/config');
    cfg.saveTokens('local', 'ax');
    cfg.saveTokens('staging', 'sx');
    cfg.clearTokens('local');
    expect(cfg.hasTokens('local')).toBe(false);
    expect(cfg.hasTokens('staging')).toBe(true);
  });

  it('clearTokens on missing env returns false (no throw)', async () => {
    const cfg = await import('../../ts/src/cli/config');
    expect(cfg.clearTokens('production')).toBe(false);
  });

  it('OPENBOX_ACCESS_TOKEN env bypasses on-disk store', async () => {
    process.env.OPENBOX_ACCESS_TOKEN = 'ephemeral-token';
    process.env.OPENBOX_API_URL = 'http://localhost:3000';
    const cfg = await import('../../ts/src/cli/config');
    // getClient just needs the token; tolerate that the constructor
    // will be invoked even though the URL won't be reachable here.
    const client = cfg.getClient('local');
    expect(client).toBeDefined();
    delete process.env.OPENBOX_ACCESS_TOKEN;
    delete process.env.OPENBOX_API_URL;
  });

  it('savePermissions on missing env is a no-op', async () => {
    const cfg = await import('../../ts/src/cli/config');
    cfg.savePermissions('production', ['some:perm']);
    expect(cfg.loadPermissions('production')).toEqual([]);
  });
});
