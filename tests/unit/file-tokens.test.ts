import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let fakeHome: string;
let fakeCwd: string;
const ORIG_HOME = process.env.OPENBOX_HOME;
const ORIG_BACKEND_API_KEY = process.env.OPENBOX_BACKEND_API_KEY;
const ORIG_API_KEY = process.env.OPENBOX_API_KEY;

beforeEach(() => {
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'obx-tokens-home-'));
  fakeCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'obx-tokens-cwd-'));
  process.env.OPENBOX_HOME = fakeHome;
  vi.spyOn(process, 'cwd').mockReturnValue(fakeCwd);
  delete process.env.OPENBOX_BACKEND_API_KEY;
  delete process.env.OPENBOX_API_KEY;
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(fakeHome, { recursive: true, force: true });
  fs.rmSync(fakeCwd, { recursive: true, force: true });
  if (ORIG_HOME === undefined) delete process.env.OPENBOX_HOME;
  else process.env.OPENBOX_HOME = ORIG_HOME;
  if (ORIG_BACKEND_API_KEY === undefined) delete process.env.OPENBOX_BACKEND_API_KEY;
  else process.env.OPENBOX_BACKEND_API_KEY = ORIG_BACKEND_API_KEY;
  if (ORIG_API_KEY === undefined) delete process.env.OPENBOX_API_KEY;
  else process.env.OPENBOX_API_KEY = ORIG_API_KEY;
});

async function loadModule() {
  return await import('../../ts/src/file-tokens/index.js');
}

describe('file-tokens', () => {
  it('loadApiKey does not create the OpenBox data directory when no token exists', async () => {
    const mod = await loadModule();
    fs.rmSync(fakeHome, { recursive: true, force: true });

    expect(mod.loadApiKey()).toBeUndefined();

    expect(fs.existsSync(fakeHome)).toBe(false);
  });

  it('saveApiKey then loadApiKey round-trips', async () => {
    const mod = await loadModule();
    expect(mod.loadApiKey()).toBeUndefined();
    mod.saveApiKey('obx_key_round_trip');
    expect(mod.loadApiKey()).toBe('obx_key_round_trip');
  });

  it('saveApiKey clears stale metadata when the key changes', async () => {
    const mod = await loadModule();
    mod.saveApiKey('obx_key_first');
    fs.writeFileSync(
      mod.getTokenPath(),
      'API_KEY=obx_key_first\nUPDATED_AT=2026-01-01T00:00:00Z\nPERMISSIONS=read:agent\nFEATURES=sso:true\n',
    );

    mod.saveApiKey('obx_key_second');

    const content = fs.readFileSync(mod.getTokenPath(), 'utf-8');
    expect(content).toContain('API_KEY=obx_key_second');
    expect(content).not.toContain('PERMISSIONS=');
    expect(content).not.toContain('FEATURES=');
  });

  it('OPENBOX_BACKEND_API_KEY env var wins over the file', async () => {
    const mod = await loadModule();
    mod.saveApiKey('obx_key_from_file');
    process.env.OPENBOX_BACKEND_API_KEY = 'obx_key_from_env';
    expect(mod.loadApiKey()).toBe('obx_key_from_env');
  });

  it('clearApiKey removes the stored key', async () => {
    const mod = await loadModule();
    mod.saveApiKey('p');
    expect(mod.clearApiKey()).toBe(true);
    expect(mod.loadApiKey()).toBeUndefined();
  });

  it('hasApiKey reflects the current state', async () => {
    const mod = await loadModule();
    expect(mod.hasApiKey()).toBe(false);
    mod.saveApiKey('k');
    expect(mod.hasApiKey()).toBe(true);
  });

  it('cwd .tokens file wins over the project .openbox token path', async () => {
    const mod = await loadModule();
    mod.saveApiKey('home_value');
    fs.writeFileSync(path.join(fakeCwd, '.tokens'), 'API_KEY=cwd_value\nUPDATED_AT=2026-01-01T00:00:00Z\n');
    expect(mod.loadApiKey()).toBe('cwd_value');
  });
});
