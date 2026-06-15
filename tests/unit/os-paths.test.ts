// OsPathResolver contract tests for platform-specific config paths.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

const originalPlatform = process.platform;
const originalEnv = { ...process.env };

function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value: p,
    writable: true,
    configurable: true,
  });
}

describe('OsPathResolver contract', () => {
  beforeEach(() => {
    // Reset env on each test so XDG / APPDATA / OPENBOX_HOME from the
    // host environment don't bleed in.
    for (const key of ['OPENBOX_HOME', 'XDG_DATA_HOME', 'APPDATA', 'HOME', 'USERPROFILE']) {
      delete process.env[key];
    }
    process.env.HOME = '/tmp/test-home';
    vi.resetModules();
  });

  afterEach(() => {
    setPlatform(originalPlatform);
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  });

  it('Linux without XDG_DATA_HOME -> ~/.openbox/<scope>', async () => {
    setPlatform('linux');
    const { resolveOsPath } = await import('../../ts/src/env/os-paths.js');
    expect(resolveOsPath('tokens')).toBe('/tmp/test-home/.openbox/tokens');
    expect(resolveOsPath('config')).toBe('/tmp/test-home/.openbox/config');
    expect(resolveOsPath('cache')).toBe('/tmp/test-home/.openbox/cache');
  });

  it('Linux honors XDG_DATA_HOME', async () => {
    setPlatform('linux');
    process.env.XDG_DATA_HOME = '/var/data';
    const { resolveOsPath } = await import('../../ts/src/env/os-paths.js');
    expect(resolveOsPath('tokens')).toBe('/var/data/openbox/tokens');
  });

  it('macOS -> ~/.openbox/<scope> (NOT ~/Library/Application Support)', async () => {
    setPlatform('darwin');
    const { resolveOsPath } = await import('../../ts/src/env/os-paths.js');
    expect(resolveOsPath('tokens')).toBe('/tmp/test-home/.openbox/tokens');
    expect(resolveOsPath('config')).toBe('/tmp/test-home/.openbox/config');
  });

  it('macOS ignores XDG_DATA_HOME', async () => {
    setPlatform('darwin');
    process.env.XDG_DATA_HOME = '/var/data';
    const { resolveOsPath } = await import('../../ts/src/env/os-paths.js');
    // macOS has no XDG convention; fall back to ~/.openbox.
    expect(resolveOsPath('tokens')).toBe('/tmp/test-home/.openbox/tokens');
  });

  it('Windows -> %APPDATA%\\openbox\\<scope>', async () => {
    setPlatform('win32');
    process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming';
    const { resolveOsPath } = await import('../../ts/src/env/os-paths.js');
    // Node's path.join uses POSIX or Windows separators based on
    // the running platform's path module; we assert prefix + suffix
    // separately since vitest is running on the dev host.
    const result = resolveOsPath('tokens');
    expect(result).toContain('openbox');
    expect(result).toContain('tokens');
    expect(result.startsWith('C:\\Users\\test\\AppData\\Roaming')).toBe(true);
  });

  it('Windows without APPDATA falls back to ~/AppData/Roaming', async () => {
    setPlatform('win32');
    process.env.HOME = 'C:\\Users\\test';
    const { resolveOsPath } = await import('../../ts/src/env/os-paths.js');
    const result = resolveOsPath('tokens');
    expect(result).toContain('AppData');
    expect(result).toContain('Roaming');
    expect(result).toContain('openbox');
  });

  it('OPENBOX_HOME hard override beats every platform', async () => {
    process.env.OPENBOX_HOME = '/sandbox/openbox';
    for (const platform of ['linux', 'darwin', 'win32'] as const) {
      setPlatform(platform);
      vi.resetModules();
      const { resolveOsPath } = await import('../../ts/src/env/os-paths.js');
      expect(resolveOsPath('tokens')).toBe('/sandbox/openbox/tokens');
    }
  });
});
