// Coverage for ts/src/cli/commands/versions.ts. Driven via stubbed
// fetch for /version live calls. Single-env (active) shape: one row
// per service, no env names surfaced. The --sources branch lists the
// URL that produced each cell.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';

beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    const u = String(url);
    if (u.endsWith('/version')) {
      return new Response(JSON.stringify({ commit: 'sha1234', version: '1.0.0' }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 404 });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function runVersions(args: string[]): Promise<{ out: string[]; exit: number | undefined }> {
  const { registerVersionsCommand } = await import('../../ts/src/cli/commands/versions');
  const program = new Command();
  program.exitOverride();
  registerVersionsCommand(program);
  const out: string[] = [];
  const ol = console.log;
  const oe = console.error;
  console.log = (...a: any[]) => out.push(a.join(' '));
  console.error = (...a: any[]) => out.push(a.join(' '));
  const ovExit = process.exit;
  let exit: number | undefined;
  (process as any).exit = ((c?: number) => { exit = c; throw new Error('exit:' + c); }) as never;
  try {
    await program.parseAsync(['node', 'openbox', 'versions', ...args]);
  } catch {
    /* expected on any exit */
  } finally {
    console.log = ol;
    console.error = oe;
    (process as any).exit = ovExit;
  }
  return { out, exit };
}

describe('versions command', () => {
  it('renders one row per service for the active env', async () => {
    const { out } = await runVersions([]);
    const flat = out.join('\n');
    expect(flat).toContain('backend');
    expect(flat).toContain('core');
    expect(flat).toContain('guardrails');
    // No env-name leak in the user-facing output.
    expect(flat).not.toContain('production');
    expect(flat).not.toContain('staging');
  });

  it('--sources adds a per-cell source breakdown', async () => {
    const { out } = await runVersions(['--sources']);
    const flat = out.join('\n');
    expect(flat).toContain('sources:');
  });

  it('prints "(no /version)" when /version is unreachable', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 502 }));
    const { out } = await runVersions([]);
    const flat = out.join('\n');
    expect(flat).toContain('(no /version)');
  });
});
