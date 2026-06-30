import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { existsSync, rmSync, statSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KEY_A = 'obx_key_' + 'a'.repeat(48);
const dir = mkdtempSync(join(tmpdir(), 'openbox-cli-config-'));
const originalHome = process.env.OPENBOX_HOME;
process.env.OPENBOX_HOME = dir;

afterEach(() => {
  delete process.env.OPENBOX_BACKEND_API_KEY;
  delete process.env.OPENBOX_API_URL;
  delete process.env.OPENBOX_CORE_URL;
});

describe('cli/config; api-key store CRUD', () => {
  it('saveApiKey writes a 0o600 file the load can round-trip', async () => {
    const cfg = await import('../../ts/src/cli/config');
    cfg.saveApiKey(KEY_A);
    const path = cfg.getTokenPath();
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(cfg.loadApiKey()).toBe(KEY_A);
  });

  it('savePermissions / saveFeatures update without clobbering the key', async () => {
    const cfg = await import('../../ts/src/cli/config');
    cfg.saveApiKey(KEY_A);
    cfg.savePermissions(['read:agent', 'create:agent']);
    cfg.saveFeatures({ webhooks: true, sso: false });
    expect(cfg.loadPermissions()).toEqual(['read:agent', 'create:agent']);
    expect(cfg.loadFeatures()).toEqual({ webhooks: true, sso: false });
    expect(cfg.loadApiKey()).toBe(KEY_A);
  });

  it('clearApiKey on missing store returns false', async () => {
    const cfg = await import('../../ts/src/cli/config');
    cfg.clearApiKey();
    expect(cfg.clearApiKey()).toBe(false);
  });

  it('OPENBOX_BACKEND_API_KEY env bypasses on-disk store', async () => {
    const cfg = await import('../../ts/src/cli/config');
    // Seed the on-disk store with a DIFFERENT key so we can prove the env
    // key wins (rather than coincidentally matching the file).
    const DISK_KEY = 'obx_key_' + 'd'.repeat(48);
    cfg.saveApiKey(DISK_KEY);
    expect(cfg.loadApiKey()).toBe(DISK_KEY);

    process.env.OPENBOX_BACKEND_API_KEY = KEY_A;
    process.env.OPENBOX_API_URL = 'http://localhost:3000';
    process.env.OPENBOX_CORE_URL = 'http://localhost:3001';
    // The env key short-circuits the file store entirely.
    expect(cfg.loadApiKey()).toBe(KEY_A);
    expect(cfg.getClient()).toBeDefined();

    // Removing the env key falls back to the still-present on-disk store,
    // confirming the env value was an override, not a replacement.
    delete process.env.OPENBOX_BACKEND_API_KEY;
    expect(cfg.loadApiKey()).toBe(DISK_KEY);
  });
});

afterAll(() => {
  if (originalHome === undefined) delete process.env.OPENBOX_HOME;
  else process.env.OPENBOX_HOME = originalHome;
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});
