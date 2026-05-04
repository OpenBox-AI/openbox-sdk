import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// `os.homedir()` is captured once at module import; mocking after
// import is racy. The SDK's `resolveOsPath` honors `OPENBOX_HOME` as a
// hard override (see ts/src/env/os-paths.ts), which is the documented
// way to redirect the user-data root. We use that here.
let fakeHome: string;
let fakeCwd: string;
const ORIG_HOME = process.env.OPENBOX_HOME;
const ORIG_API_KEY = process.env.OPENBOX_BACKEND_API_KEY;

beforeEach(() => {
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'obx-tokens-home-'));
  fakeCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'obx-tokens-cwd-'));
  process.env.OPENBOX_HOME = fakeHome;
  vi.spyOn(process, 'cwd').mockReturnValue(fakeCwd);
  delete process.env.OPENBOX_BACKEND_API_KEY;
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(fakeHome, { recursive: true, force: true });
  fs.rmSync(fakeCwd, { recursive: true, force: true });
  if (ORIG_HOME === undefined) delete process.env.OPENBOX_HOME;
  else process.env.OPENBOX_HOME = ORIG_HOME;
  if (ORIG_API_KEY === undefined) delete process.env.OPENBOX_BACKEND_API_KEY;
  else process.env.OPENBOX_BACKEND_API_KEY = ORIG_API_KEY;
});

async function loadModule() {
  return await import('../../ts/src/file-tokens/index.js');
}

describe('file-tokens', () => {
  it('saveApiKey then loadApiKey round-trips', async () => {
    const mod = await loadModule();
    expect(mod.loadApiKey('production')).toBeUndefined();
    mod.saveApiKey('production', 'obx_key_round_trip');
    expect(mod.loadApiKey('production')).toBe('obx_key_round_trip');
  });

  it('OPENBOX_BACKEND_API_KEY env var wins over the file', async () => {
    const mod = await loadModule();
    mod.saveApiKey('production', 'obx_key_from_file');
    process.env.OPENBOX_BACKEND_API_KEY = 'obx_key_from_env';
    expect(mod.loadApiKey('production')).toBe('obx_key_from_env');
  });

  it('clearApiKey removes only the targeted env', async () => {
    const mod = await loadModule();
    mod.saveApiKey('production', 'p');
    mod.saveApiKey('staging', 's');
    expect(mod.clearApiKey('production')).toBe(true);
    expect(mod.loadApiKey('production')).toBeUndefined();
    expect(mod.loadApiKey('staging')).toBe('s');
  });

  it('clearApiKey returns false when nothing was there', async () => {
    const mod = await loadModule();
    expect(mod.clearApiKey('production')).toBe(false);
  });

  it('hasApiKey reflects the current state', async () => {
    const mod = await loadModule();
    expect(mod.hasApiKey('production')).toBe(false);
    mod.saveApiKey('production', 'k');
    expect(mod.hasApiKey('production')).toBe(true);
    mod.clearApiKey('production');
    expect(mod.hasApiKey('production')).toBe(false);
  });

  it('cwd .tokens file wins over the user-data path', async () => {
    const mod = await loadModule();
    // Pre-populate user-data path
    mod.saveApiKey('production', 'home_value');
    // Drop a .tokens in the cwd that overrides
    fs.writeFileSync(
      path.join(fakeCwd, '.tokens'),
      'production.API_KEY=cwd_value\nproduction.UPDATED_AT=2026-01-01T00:00:00Z\n',
    );
    expect(mod.loadApiKey('production')).toBe('cwd_value');
  });
});
