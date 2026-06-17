import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, existsSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

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
} = await import('../../ts/src/config/store.js');

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
  it('read operations do not create an OpenBox data directory', () => {
    const dir = dirname(configStorePath());
    rmSync(dir, { recursive: true, force: true });

    expect(getConfig('OPENBOX_CORE_URL')).toBeUndefined();
    expect(listConfig()).toEqual({});

    expect(existsSync(dir)).toBe(false);
  });

  it('round-trips a project-local value', () => {
    setConfig('OPENBOX_API_URL', 'https://api.example/ob');
    expect(getConfig('OPENBOX_API_URL')).toBe('https://api.example/ob');
  });

  it('ignores invalid entries when reading', () => {
    writeFileSync(configStorePath(), 'bad.key=https://invalid\nOPENBOX_CORE_URL=https://core\n', { mode: 0o600 });
    expect(listConfig()).toEqual({ OPENBOX_CORE_URL: 'https://core' });
  });

  it('writes the file at mode 0o600', () => {
    setConfig('X', 'y');
    expect(statSync(configStorePath()).mode & 0o777).toBe(0o600);
  });

  it('unset removes a value and is idempotent', () => {
    setConfig('A', '1');
    expect(unsetConfig('A')).toEqual({ scope: 'project', removed: true });
    expect(getConfig('A')).toBeUndefined();
    expect(unsetConfig('A')).toEqual({ scope: 'project', removed: false });
  });

  it('rejects empty keys', () => {
    expect(() => setConfig('', 'value')).toThrow(/key/i);
    expect(() => setConfig('bad.key', 'value')).toThrow(/invalid config key/i);
  });

  it('applyConfigToProcessEnv populates only unset vars', () => {
    setConfig('OPENBOX_API_URL', 'https://from-config.example');
    setConfig('OPENBOX_CORE_URL', 'https://core-from-config.example');
    delete process.env.OPENBOX_API_URL;
    process.env.OPENBOX_CORE_URL = 'https://shell-export.example';

    applyConfigToProcessEnv();

    expect(process.env.OPENBOX_API_URL).toBe('https://from-config.example');
    expect(process.env.OPENBOX_CORE_URL).toBe('https://shell-export.example');

    delete process.env.OPENBOX_API_URL;
    delete process.env.OPENBOX_CORE_URL;
  });

  it('configStorePath lives under OPENBOX_HOME', () => {
    expect(configStorePath().startsWith(sandbox)).toBe(true);
    setConfig('OPENBOX_API_URL', 'https://api.example/ob');
    expect(readFileSync(configStorePath(), 'utf-8')).toContain('OpenBox CLI config');
  });
});
