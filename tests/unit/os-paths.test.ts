// OsPathResolver contract tests for project-local config paths.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

const originalEnv = { ...process.env };

describe('OsPathResolver contract', () => {
  beforeEach(() => {
    for (const key of ['OPENBOX_HOME', 'XDG_DATA_HOME', 'APPDATA', 'HOME', 'USERPROFILE']) {
      delete process.env[key];
    }
    vi.spyOn(process, 'cwd').mockReturnValue('/tmp/test-project');
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  });

  it('defaults to <cwd>/.openbox/<scope>', async () => {
    const { resolveOsPath } = await import('../../ts/src/env/os-paths.js');
    expect(resolveOsPath('tokens')).toBe('/tmp/test-project/.openbox/tokens');
    expect(resolveOsPath('config')).toBe('/tmp/test-project/.openbox/config');
    expect(resolveOsPath('cache')).toBe('/tmp/test-project/.openbox/cache');
  });

  it('ignores user-level platform data dirs by default', async () => {
    process.env.XDG_DATA_HOME = '/var/data';
    process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming';
    const { resolveOsPath } = await import('../../ts/src/env/os-paths.js');
    expect(resolveOsPath('tokens')).toBe('/tmp/test-project/.openbox/tokens');
  });

  it('OPENBOX_HOME hard override beats the project-local default', async () => {
    process.env.OPENBOX_HOME = '/sandbox/openbox';
    const { resolveOsPath } = await import('../../ts/src/env/os-paths.js');
    expect(resolveOsPath('tokens')).toBe('/sandbox/openbox/tokens');
  });
});
