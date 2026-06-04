import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import {
  parseHostScope,
  registerInstallCommands,
} from '../../ts/src/cli/commands/install.js';
import { Command } from 'commander';

const temps: string[] = [];
const originalEnv = { ...process.env };

function tempDir(): string {
  const dir = mkdtempSync(join(os.tmpdir(), 'openbox-install-branch-'));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  process.env = { ...originalEnv };
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('install command branch coverage', () => {
  it('covers project-scope validation', () => {
    expect(parseHostScope(undefined, 'cursor')).toBe('project');
    expect(parseHostScope('PROJECT', 'cursor')).toBe('project');

    const originalExit = process.exit;
    (process as unknown as { exit: (code?: number) => never }).exit = ((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never;
    try {
      expect(() => parseHostScope('bad', 'cursor')).toThrow('exit:2');
      expect(() => parseHostScope('global', 'cursor')).toThrow('exit:2');
      expect(() => parseHostScope('global', 'claude-code')).toThrow('exit:2');
      expect(() => parseHostScope('local', 'cursor')).toThrow('exit:2');
      expect(() => parseHostScope('local', 'claude-code')).toThrow('exit:2');
    } finally {
      (process as unknown as { exit: typeof originalExit }).exit = originalExit;
    }

  });

  it('rejects removed Cursor direct-install flags', async () => {
    const home = tempDir();
    process.env.HOME = home;

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => {}, writeOut: () => {} });
    registerInstallCommands(program);

    const originalExit = process.exit;
    (process as unknown as { exit: (code?: number) => never }).exit = ((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never;
    try {
      await expect(
        program.parseAsync(['node', 'openbox', 'install', 'cursor', '--scope', 'project']),
      ).rejects.toThrow(/unknown option|exit:2/);
      await expect(
        program.parseAsync(['node', 'openbox', 'install', 'cursor', '--no-mcp']),
      ).rejects.toThrow(/unknown option|exit:2/);
    } finally {
      (process as unknown as { exit: typeof originalExit }).exit = originalExit;
    }
  });
});
