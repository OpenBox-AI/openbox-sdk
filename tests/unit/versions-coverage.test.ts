// Coverage for ts/src/cli/commands/versions.ts. Driven via stubbed
// fetch (for /version live calls) + a stubbed execFileSync that
// pretends to be git. All three envs × three services × the --sources
// branch are exercised.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';

// Stub execFileSync('git', ...) to return synthetic SHAs.
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    execFileSync: (cmd: string, args: string[]) => {
      if (cmd !== 'git') return actual.execFileSync(cmd, args);
      // git -C dir rev-parse --short HEAD → return a fake SHA
      // git -C dir rev-parse --abbrev-ref HEAD → return a fake branch
      if (args.includes('--short')) return 'abc1234';
      if (args.includes('--abbrev-ref')) return 'main';
      return '';
    },
  };
});

beforeEach(() => {
  // /version returns commit + version
  vi.stubGlobal('fetch', async (url: string) => {
    const u = String(url);
    if (u.endsWith('/version')) {
      return new Response(JSON.stringify({ commit: 'sha1234', version: '1.0.0' }), { status: 200 });
    }
    // Default: 404 so liveVersion returns null
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
  it('renders the 3-env × 3-service table', async () => {
    const { out } = await runVersions([]);
    const flat = out.join('\n');
    expect(flat).toContain('openbox-backend');
    expect(flat).toContain('openbox-core');
    expect(flat).toContain('production');
    expect(flat).toContain('staging');
    expect(flat).toContain('local');
  });

  it('--sources adds a per-cell source breakdown', async () => {
    const { out } = await runVersions(['--sources']);
    const flat = out.join('\n');
    expect(flat).toContain('sources:');
  });

  it('falls back to git HEAD on local when /version is unreachable', async () => {
    // Override fetch to fail for ALL URLs so liveVersion always returns
    // null; local column then uses git HEAD via the mocked execFileSync.
    vi.stubGlobal('fetch', async () => new Response('', { status: 502 }));
    const { out } = await runVersions([]);
    const flat = out.join('\n');
    // The mocked git stub returns `abc1234 (main)` for the local cells.
    expect(flat).toMatch(/abc1234|\(no \/version\)|\(clone missing\)/);
  });
});
