import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const oldHome = process.env.OPENBOX_HOME;
const oldDebug = process.env.OPENBOX_DEBUG;

afterEach(() => {
  if (oldHome === undefined) delete process.env.OPENBOX_HOME;
  else process.env.OPENBOX_HOME = oldHome;
  if (oldDebug === undefined) delete process.env.OPENBOX_DEBUG;
  else process.env.OPENBOX_DEBUG = oldDebug;
});

describe('cli/env-source', () => {
  it('applies config-backed env defaults and detects debug mode', async () => {
    const home = mkdtempSync(join(tmpdir(), 'openbox-env-source-'));
    process.env.OPENBOX_HOME = home;
    delete process.env.OPENBOX_DEBUG;
    try {
      const { setConfig } = await import('../../ts/src/cli/config-store.ts');
      const { applyEnvSource, isDebugMode } = await import('../../ts/src/cli/env-source.ts');

      setConfig('OPENBOX_DEBUG', 'yes');
      setConfig('OPENBOX_API_URL', 'http://localhost:3000');

      delete process.env.OPENBOX_API_URL;
      applyEnvSource();
      expect(process.env.OPENBOX_API_URL).toBe('http://localhost:3000');
      expect(isDebugMode()).toBe(true);

      process.env.OPENBOX_DEBUG = '0';
      expect(isDebugMode()).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
