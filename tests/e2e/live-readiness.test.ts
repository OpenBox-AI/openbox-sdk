import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { optionalOpenBoxCli } from '../helpers/openbox-cli.js';

const CLI_BIN = optionalOpenBoxCli();

async function canReach(url: string | undefined, path: string): Promise<boolean> {
  if (!url) return false;
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}${path}`, {
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

describe('live OpenBox E2E readiness', () => {
  it('reports whether the full backend/core lifecycle proof can run', async () => {
    const checks = {
      cliAvailable: !!CLI_BIN && existsSync(CLI_BIN),
      backendUrl: Boolean(process.env.OPENBOX_API_URL),
      backendReachable: await canReach(process.env.OPENBOX_API_URL, '/health'),
      backendApiKey: Boolean(process.env.OPENBOX_BACKEND_API_KEY),
      orgId: Boolean(process.env.OPENBOX_ORG_ID),
      coreUrl: Boolean(process.env.OPENBOX_CORE_URL),
      coreReachable: await canReach(process.env.OPENBOX_CORE_URL, '/'),
      runtimeKey: Boolean(process.env.OPENBOX_API_KEY),
    };

    if (process.env.OPENBOX_E2E_REQUIRED === '1') {
      expect(checks).toEqual({
        cliAvailable: true,
        backendUrl: true,
        backendReachable: true,
        backendApiKey: true,
        orgId: true,
        coreUrl: true,
        coreReachable: true,
        runtimeKey: true,
      });
    } else {
      expect(Object.keys(checks)).toEqual([
        'cliAvailable',
        'backendUrl',
        'backendReachable',
        'backendApiKey',
        'orgId',
        'coreUrl',
        'coreReachable',
        'runtimeKey',
      ]);
    }
  });
});
