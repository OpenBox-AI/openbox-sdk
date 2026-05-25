import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { registerConfigCommands } from '../../ts/src/cli/commands/config.ts';
import { registerConnectCommand } from '../../ts/src/cli/commands/connect.ts';
import { registerCursorCommands } from '../../ts/src/cli/commands/cursor.ts';

let home: string;
let project: string;
let oldHome: string | undefined;
let oldOpenboxHome: string | undefined;
let oldApiUrl: string | undefined;
let oldCoreUrl: string | undefined;
let oldBackendKey: string | undefined;

function programWith(register: (program: Command) => void): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => undefined,
    writeErr: () => undefined,
  });
  register(program);
  return program;
}

async function run(program: Command, args: string[]): Promise<void> {
  await program.parseAsync(args, { from: 'user' });
}

beforeEach(() => {
  oldHome = process.env.HOME;
  oldOpenboxHome = process.env.OPENBOX_HOME;
  oldApiUrl = process.env.OPENBOX_API_URL;
  oldCoreUrl = process.env.OPENBOX_CORE_URL;
  oldBackendKey = process.env.OPENBOX_BACKEND_API_KEY;
  home = mkdtempSync(join(tmpdir(), 'openbox-cli-home-'));
  project = mkdtempSync(join(tmpdir(), 'openbox-cli-project-'));
  process.env.HOME = home;
  process.env.OPENBOX_HOME = join(home, '.openbox');
  process.env.OPENBOX_API_URL = 'https://api.local.test';
  process.env.OPENBOX_CORE_URL = 'https://core.local.test';
  process.env.OPENBOX_BACKEND_API_KEY = 'obx_key_' + 'a'.repeat(48);
  vi.stubGlobal('fetch', async (url: string) => {
    const u = String(url);
    if (u.endsWith('/.well-known/openbox.json')) {
      return new Response(
        JSON.stringify({
          apiUrl: 'https://api.dev.test/ob',
          coreUrl: 'https://core.dev.test/ob',
          platformUrl: 'https://platform.dev.test',
        }),
        { status: 200 },
      );
    }
    if (u.endsWith('/auth/profile')) {
      return new Response(
        JSON.stringify({ status: 200, data: { orgId: 'org-dev', email: 'dev@example.test' } }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ status: 200, data: {} }), { status: 200 });
  });
});

afterEach(() => {
  if (oldHome === undefined) delete process.env.HOME;
  else process.env.HOME = oldHome;
  if (oldOpenboxHome === undefined) delete process.env.OPENBOX_HOME;
  else process.env.OPENBOX_HOME = oldOpenboxHome;
  if (oldApiUrl === undefined) delete process.env.OPENBOX_API_URL;
  else process.env.OPENBOX_API_URL = oldApiUrl;
  if (oldCoreUrl === undefined) delete process.env.OPENBOX_CORE_URL;
  else process.env.OPENBOX_CORE_URL = oldCoreUrl;
  if (oldBackendKey === undefined) delete process.env.OPENBOX_BACKEND_API_KEY;
  else process.env.OPENBOX_BACKEND_API_KEY = oldBackendKey;
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CLI command action coverage', () => {
  it('config set/get/list/unset exercise scoped and global config actions', async () => {
    const config = programWith(registerConfigCommands);

    await run(config, ['config', 'set', 'OPENBOX_API_URL', 'https://api.local.test']);
    await run(config, ['config', 'get', 'OPENBOX_API_URL']);
    await run(config, ['config', 'list']);
    await run(config, ['config', 'set', 'OPENBOX_CORE_URL', 'https://core.local.test']);
    await run(config, ['config', 'list']);
    await run(config, ['config', 'unset', 'OPENBOX_API_URL']);

    const { getConfig } = await import('../../ts/src/cli/config-store.ts');
    expect(getConfig('OPENBOX_API_URL')).toBeUndefined();
    expect(getConfig('OPENBOX_CORE_URL')).toBe('https://core.local.test');
  });

  it('connect saves discovered endpoints and validates the supplied API key', async () => {
    const connect = programWith(registerConnectCommand);

    await run(connect, [
      'connect',
      'https://ipsum.test',
      '--api-key',
      'obx_key_' + 'b'.repeat(48),
    ]);

    const { getConfig } = await import('../../ts/src/cli/config-store.ts');
    expect(getConfig('OPENBOX_API_URL')).toBe('https://api.dev.test/ob');
    expect(getConfig('OPENBOX_CORE_URL')).toBe('https://core.dev.test/ob');
  });

  it('cursor command actions install, inspect, harden, and uninstall project-scoped surfaces', async () => {
    const cursor = programWith(registerCursorCommands);

    await run(cursor, [
      'cursor',
      'install',
      '--scope',
      'project',
      '--cwd',
      project,
      '--matcher',
      'beforeShellExecution=rm',
    ]);
    await run(cursor, [
      'cursor',
      'doctor',
      '--scope',
      'project',
      '--cwd',
      project,
      '--surface-only',
      '--json',
    ]);
    await run(cursor, ['cursor', 'harden', '--dry-run']);
    await run(cursor, ['cursor', 'unharden']);
    await run(cursor, ['cursor', 'uninstall', '--scope', 'project', '--cwd', project]);
  });
});
