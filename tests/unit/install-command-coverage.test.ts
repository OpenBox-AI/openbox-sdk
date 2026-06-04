import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';

import {
  parseHostScope,
  registerInstallCommands,
} from '../../ts/src/cli/commands/install.ts';

const temps: string[] = [];
const originalEnv = { ...process.env };
const originalCwd = process.cwd();

function tempDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), name));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  process.env = { ...originalEnv };
  process.chdir(originalCwd);
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function runInstallCli(args: string[]): Promise<void> {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => undefined,
    writeErr: () => undefined,
  });
  registerInstallCommands(program);
  await program.parseAsync(args, { from: 'user' });
}

describe('minimal install command', () => {
  it('keeps only project-local cursor and claude-code install targets', () => {
    const program = new Command();
    registerInstallCommands(program);
    const install = program.commands.find((command) => command.name() === 'install');
    expect(install?.commands.map((command) => command.name()).sort()).toEqual([
      'claude-code',
      'cursor',
    ]);
    const uninstall = program.commands.find((command) => command.name() === 'uninstall');
    expect(uninstall?.commands.map((command) => command.name()).sort()).toEqual([
      'claude-code',
      'cursor',
    ]);
  });

  it('validates host scopes', () => {
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

  it('installs and removes a project-local Cursor plugin without user-level Cursor writes', async () => {
    const home = tempDir('openbox-install-home-');
    const project = tempDir('openbox-install-project-');
    const plugin = join(project, '.cursor', 'plugins', 'local', 'openbox');
    process.env.HOME = home;

    await runInstallCli(['install', 'cursor', '--cwd', project, '--plugin-target', plugin]);

    expect(existsSync(join(plugin, '.cursor-plugin', 'plugin.json'))).toBe(true);
    expect(existsSync(join(plugin, 'hooks', 'hooks.json'))).toBe(true);
    expect(existsSync(join(plugin, 'mcp.json'))).toBe(true);
    expect(existsSync(join(plugin, 'skills', 'openbox', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(project, '.cursor-hooks', 'config.json'))).toBe(true);
    expect(existsSync(join(home, '.cursor', 'hooks.json'))).toBe(false);
    expect(existsSync(join(home, '.cursor', 'mcp.json'))).toBe(false);
    expect(existsSync(join(home, '.cursor', 'plugins', 'local', 'openbox'))).toBe(false);

    await runInstallCli(['uninstall', 'cursor', '--cwd', project, '--plugin-target', plugin]);
    expect(existsSync(plugin)).toBe(false);
  });

  it('installs and removes a project Claude Code plugin without direct settings writes', async () => {
    const project = tempDir('openbox-install-claude-');

    await runInstallCli(['install', 'claude-code', '--scope', 'project', '--cwd', project]);

    const plugin = join(project, '.claude', 'skills', 'openbox');
    expect(existsSync(join(plugin, '.claude-plugin', 'plugin.json'))).toBe(true);
    expect(existsSync(join(plugin, 'hooks', 'hooks.json'))).toBe(true);
    expect(existsSync(join(plugin, '.mcp.json'))).toBe(true);
    expect(existsSync(join(plugin, 'skills', 'openbox', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(project, '.claude-hooks', 'config.json'))).toBe(true);
    expect(existsSync(join(project, '.claude', 'settings.json'))).toBe(false);

    await runInstallCli(['uninstall', 'claude-code', '--scope', 'project', '--cwd', project]);
    expect(existsSync(plugin)).toBe(false);
  });

  it('rejects old direct Cursor install flags', async () => {
    const home = tempDir('openbox-install-home-');
    const project = tempDir('openbox-install-project-');
    process.env.HOME = home;

    await expect(runInstallCli(['install', 'cursor', '--scope', 'project', '--cwd', project]))
      .rejects.toThrow(/unknown option|error|exit/i);
    expect(existsSync(join(project, '.cursor', 'hooks.json'))).toBe(false);

    await expect(runInstallCli(['uninstall', 'cursor', '--scope', 'project', '--cwd', project]))
      .rejects.toThrow(/unknown option|error|exit/i);
  });

  it('rejects removed broad install targets', async () => {
    await expect(runInstallCli(['install', 'mcp'])).rejects.toThrow(/unknown command|error/);
    await expect(runInstallCli(['install', 'skill'])).rejects.toThrow(/unknown command|error/);
    await expect(runInstallCli(['install', 'mobile'])).rejects.toThrow(/unknown command|error/);
    await expect(runInstallCli(['install', 'extension'])).rejects.toThrow(/unknown command|error/);
    await expect(runInstallCli(['uninstall', 'extension'])).rejects.toThrow(/unknown command|error/);
  });

  it('rejects old direct Claude Code install flags', async () => {
    const project = tempDir('openbox-install-project-');

    await expect(runInstallCli(['install', 'claude-code', '--scope', 'local', '--cwd', project]))
      .rejects.toThrow(/invalid value|error|exit/i);
    await expect(runInstallCli(['install', 'claude-code', '--scope', 'global', '--cwd', project]))
      .rejects.toThrow(/invalid value|error|exit/i);
    await expect(runInstallCli(['install', 'claude-code', '--no-mcp']))
      .rejects.toThrow(/unknown option|error|exit/i);
  });
});
