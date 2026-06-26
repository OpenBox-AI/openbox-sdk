import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
}

function readDotenv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq)] = JSON.parse(trimmed.slice(eq + 1)) as string;
  }
  return out;
}

function expectRuntimeConfig(
  project: string,
  provider: 'codex' | 'cursor',
  runtimeKey: string,
  coreUrl: string,
  approvalMode: string,
  identity?: { did: string; privateKey: string },
): void {
  const env = readDotenv(join(project, '.openbox', provider, '.env'));
  expect(env.OPENBOX_API_KEY).toBe(runtimeKey);
  expect(env.OPENBOX_CORE_URL).toBe(coreUrl);
  if (identity) {
    expect(env.OPENBOX_AGENT_DID).toBe(identity.did);
    expect(env.OPENBOX_AGENT_PRIVATE_KEY).toBe(identity.privateKey);
  }

  const config = readJson(join(project, '.openbox', provider, 'config.json'));
  expect(config.approvalMode).toBe(approvalMode);
  expect(config.governanceTimeout).toBe('21');
  expect(config.hitlMaxWait).toBe(120);
  expect(config.hitlPollInterval).toBe(3);
  expect(config.OPENBOX_API_KEY).toBeUndefined();
  expect(config.OPENBOX_CORE_URL).toBeUndefined();
}

function expectClaudeRuntimeConfig(
  project: string,
  runtimeKey: string,
  coreUrl: string,
  approvalMode: string,
  identity?: { did: string; privateKey: string },
): void {
  const settings = readJson(join(project, '.claude', 'settings.local.json'));
  const env = settings.env as Record<string, unknown>;
  expect(env.OPENBOX_API_KEY).toBe(runtimeKey);
  expect(env.OPENBOX_CORE_URL).toBe(coreUrl);
  if (identity) {
    expect(env.OPENBOX_AGENT_DID).toBe(identity.did);
    expect(env.OPENBOX_AGENT_PRIVATE_KEY).toBe(identity.privateKey);
  }

  const config = readJson(join(project, '.openbox', 'claude-code', 'config.json'));
  expect(config.approvalMode).toBe(approvalMode);
  expect(config.governanceTimeout).toBe('21');
  expect(config.hitlMaxWait).toBe(120);
  expect(config.hitlPollInterval).toBe(3);
  expect(config.OPENBOX_API_KEY).toBeUndefined();
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
  it('keeps only project-local host install targets', () => {
    const program = new Command();
    registerInstallCommands(program);
    const install = program.commands.find((command) => command.name() === 'install');
    expect(install?.commands.map((command) => command.name()).sort()).toEqual([
      'claude-code',
      'codex',
      'cursor',
    ]);
    const uninstall = program.commands.find((command) => command.name() === 'uninstall');
    expect(uninstall?.commands.map((command) => command.name()).sort()).toEqual([
      'claude-code',
      'codex',
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
    expect(existsSync(join(project, '.openbox', 'cursor', 'config.json'))).toBe(true);
    expect(existsSync(join(home, '.cursor', 'hooks.json'))).toBe(false);
    expect(existsSync(join(home, '.cursor', 'mcp.json'))).toBe(false);
    expect(existsSync(join(home, '.cursor', 'plugins', 'local', 'openbox'))).toBe(false);

    await runInstallCli(['uninstall', 'cursor', '--cwd', project, '--plugin-target', plugin]);
    expect(existsSync(plugin)).toBe(false);
  });

  it('installs and removes Cursor repo mode files', async () => {
    const project = tempDir('openbox-install-cursor-repo-');

    await runInstallCli(['install', 'cursor', '--mode', 'repo', '--cwd', project]);
    expect(existsSync(join(project, '.cursor', 'hooks.json'))).toBe(true);
    expect(existsSync(join(project, '.cursor', 'mcp.json'))).toBe(true);
    expect(existsSync(join(project, '.cursor', 'rules', 'openbox-governance.mdc'))).toBe(true);
    expect(existsSync(join(project, '.agents', 'skills', 'openbox', 'SKILL.md'))).toBe(true);

    await runInstallCli(['uninstall', 'cursor', '--mode', 'repo', '--cwd', project]);
    expect(existsSync(join(project, '.cursor', 'hooks.json'))).toBe(false);
    expect(existsSync(join(project, '.agents', 'skills', 'openbox'))).toBe(false);
  });

  it('installs and removes a project Claude Code plugin without direct settings writes', async () => {
    const project = tempDir('openbox-install-claude-');

    await runInstallCli(['install', 'claude-code', '--scope', 'project', '--cwd', project]);

    const plugin = join(project, '.claude', 'skills', 'openbox');
    expect(existsSync(join(plugin, '.claude-plugin', 'plugin.json'))).toBe(true);
    expect(existsSync(join(plugin, 'hooks', 'hooks.json'))).toBe(true);
    expect(existsSync(join(plugin, '.mcp.json'))).toBe(true);
    expect(existsSync(join(plugin, 'skills', 'openbox', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(plugin, 'instructions', 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(project, '.openbox', 'claude-code', 'config.json'))).toBe(true);
    expect(existsSync(join(project, '.claude', 'settings.json'))).toBe(false);

    await runInstallCli(['uninstall', 'claude-code', '--scope', 'project', '--cwd', project]);
    expect(existsSync(plugin)).toBe(false);
  });

  it('installs and removes project-local Codex surfaces without user-level writes', async () => {
    const home = tempDir('openbox-install-home-');
    const project = tempDir('openbox-install-codex-');
    process.env.HOME = home;

    await runInstallCli(['install', 'codex', '--cwd', project]);

    const plugin = join(project, '.agents', 'plugins', 'openbox');
    expect(existsSync(join(project, '.codex', 'hooks.json'))).toBe(true);
    expect(existsSync(join(project, '.codex', 'config.toml'))).toBe(true);
    expect(existsSync(join(project, '.codex', 'mcp.json'))).toBe(false);
    expect(existsSync(join(plugin, '.codex-plugin', 'plugin.json'))).toBe(true);
    expect(existsSync(join(project, '.agents', 'skills', 'openbox', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(project, '.agents', 'plugins', 'marketplace.json'))).toBe(true);
    expect(existsSync(join(home, '.codex', 'config.toml'))).toBe(false);

    await runInstallCli(['uninstall', 'codex', '--cwd', project]);
    expect(existsSync(plugin)).toBe(false);
    expect(existsSync(join(project, '.agents', 'skills', 'openbox'))).toBe(false);
  });

  it('writes shared agent runtime settings from top-level install flags for each host', async () => {
    const runtimeKey = `obx_test_${'d'.repeat(48)}`;
    const coreUrl = 'http://127.0.0.1:8086';
    const identity = {
      did: 'did:aip:550e8400-e29b-41d4-a716-446655440000',
      privateKey: Buffer.alloc(32, 1).toString('base64'),
    };
    const cursorProject = tempDir('openbox-install-runtime-cursor-');
    const claudeProject = tempDir('openbox-install-runtime-claude-');
    const codexProject = tempDir('openbox-install-runtime-codex-');
    const cursorPlugin = join(cursorProject, '.cursor', 'plugins', 'local', 'openbox');

    const runtimeFlags = [
      '--runtime-api-key',
      runtimeKey,
      '--core-url',
      coreUrl,
      '--agent-did',
      identity.did,
      '--agent-private-key',
      identity.privateKey,
      '--governance-timeout',
      '21',
      '--hitl-max-wait',
      '120',
      '--hitl-poll-interval',
      '3',
    ];

    await runInstallCli([
      'install',
      'cursor',
      '--cwd',
      cursorProject,
      '--plugin-target',
      cursorPlugin,
      '--approval-mode',
      'inline',
      ...runtimeFlags,
    ]);
    await runInstallCli([
      'install',
      'claude-code',
      '--scope',
      'project',
      '--cwd',
      claudeProject,
      '--approval-mode',
      'remote',
      ...runtimeFlags,
    ]);
    await runInstallCli([
      'install',
      'codex',
      '--cwd',
      codexProject,
      '--approval-mode',
      'defer',
      ...runtimeFlags,
    ]);

    expectRuntimeConfig(cursorProject, 'cursor', runtimeKey, coreUrl, 'inline', identity);
    expectClaudeRuntimeConfig(claudeProject, runtimeKey, coreUrl, 'remote', identity);
    expectRuntimeConfig(codexProject, 'codex', runtimeKey, coreUrl, 'defer', identity);
  });

  it('rejects incomplete direct signing identity flags', async () => {
    const project = tempDir('openbox-install-runtime-incomplete-');
    const runtimeKey = `obx_test_${'e'.repeat(48)}`;

    const originalExit = process.exit;
    (process as unknown as { exit: (code?: number) => never }).exit = ((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never;
    try {
      await expect(
        runInstallCli([
          'install',
          'claude-code',
          '--cwd',
          project,
          '--runtime-api-key',
          runtimeKey,
          '--agent-did',
          'did:aip:550e8400-e29b-41d4-a716-446655440000',
        ]),
      ).rejects.toThrow('exit:2');
    } finally {
      (process as unknown as { exit: typeof originalExit }).exit = originalExit;
    }
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
