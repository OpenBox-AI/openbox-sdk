import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { registerConfigCommands } from '../../ts/src/cli/commands/config.ts';
import { registerConnectCommand } from '../../ts/src/cli/commands/connect.ts';
import { registerCursorCommands } from '../../ts/src/cli/commands/cursor.ts';
import { registerClaudeCodeCommands } from '../../ts/src/cli/commands/claude-code.ts';
import { registerAuthCommands } from '../../ts/src/cli/commands/auth.ts';
import { installSkill, registerSkillCommands } from '../../ts/src/cli/commands/skill.ts';

let home: string;
let project: string;
let oldHome: string | undefined;
let oldOpenboxHome: string | undefined;
let oldApiUrl: string | undefined;
let oldCoreUrl: string | undefined;
let oldBackendKey: string | undefined;
const originalStdoutIsTTY = process.stdout.isTTY;

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

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
}

function expectRuntimeConfig(
  file: string,
  runtimeKey: string,
  coreUrl: string,
  approvalMode: string,
): void {
  const config = readJson(file);
  expect(config.OPENBOX_API_KEY).toBe(runtimeKey);
  expect(config.OPENBOX_CORE_URL).toBe(coreUrl);
  expect(config.approvalMode).toBe(approvalMode);
  expect(config.governanceTimeout).toBe('18');
  expect(config.hitlMaxWait).toBe(90);
  expect(config.hitlPollInterval).toBe(4);
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
  Object.defineProperty(process.stdout, 'isTTY', {
    value: originalStdoutIsTTY,
    configurable: true,
    writable: true,
  });
});

describe('CLI command action coverage', () => {
  it('config set/get/list/unset exercise project-local config actions', async () => {
    const config = programWith(registerConfigCommands);

    await run(config, ['config', 'set', 'OPENBOX_API_URL', 'https://api.local.test']);
    await run(config, ['config', 'get', 'OPENBOX_API_URL']);
    await run(config, ['config', 'list']);
    await run(config, ['config', 'set', 'OPENBOX_CORE_URL', 'https://core.local.test']);
    await run(config, ['config', 'list']);
    await run(config, ['config', 'unset', 'OPENBOX_API_URL']);

    const { getConfig } = await import('../../ts/src/config/store.ts');
    expect(getConfig('OPENBOX_API_URL')).toBeUndefined();
    expect(getConfig('OPENBOX_CORE_URL')).toBe('https://core.local.test');
  });

  it('connect saves explicit endpoints and validates the supplied API key', async () => {
    const connect = programWith(registerConnectCommand);

    await run(connect, [
      'connect',
      '--api-url',
      'https://api.dev.test/ob',
      '--core-url',
      'https://core.dev.test/ob',
      '--api-key',
      'obx_key_' + 'b'.repeat(48),
    ]);

    const { getConfig } = await import('../../ts/src/config/store.ts');
    expect(getConfig('OPENBOX_API_URL')).toBe('https://api.dev.test/ob');
    expect(getConfig('OPENBOX_CORE_URL')).toBe('https://core.dev.test/ob');
  });

  it('connect handles no-key local setup and rejects insecure non-local endpoints', async () => {
    const connect = programWith(registerConnectCommand);
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
      writable: true,
    });

    await run(connect, [
      'connect',
      '--api-url',
      'http://localhost:3000/api/',
      '--core-url',
      'http://127.0.0.1:8080/core/',
      '--no-validate',
    ]);
    await expect(
      run(connect, [
        'connect',
        '--api-url',
        'http://example.test/api',
        '--core-url',
        'https://core.dev.test',
      ]),
    ).rejects.toThrow();
  });

  it('auth command actions cover key validation, status, profile, and permissions', async () => {
    const auth = programWith(registerAuthCommands);

    await run(auth, ['auth', 'clear-api-key']);
    await run(auth, ['auth', 'status']);
    await expect(run(auth, ['auth', 'set-api-key', '--key', 'bad-key'])).rejects.toThrow();
    await run(auth, ['auth', 'set-api-key', '--key', 'obx_key_' + 'c'.repeat(48)]);
    await run(auth, ['auth', 'status']);
    await run(auth, ['auth', 'profile']);
    await run(auth, ['auth', 'permissions']);
  });

  it('cursor command actions export/install/inspect/uninstall the plugin surface', async () => {
    const cursor = programWith(registerCursorCommands);
    const runtimeKey = `obx_test_${'e'.repeat(48)}`;
    const coreUrl = 'http://127.0.0.1:8086';
    const exported = join(project, 'exported-plugin');
    const exportedWithMatcher = join(project, 'exported-plugin-matcher');
    const installed = join(project, 'installed-plugin');
    const symlinked = join(project, 'symlinked-plugin');

    await run(cursor, [
      'cursor',
      'plugin',
      'export',
      '--out',
      exported,
      '--matcher',
      'beforeShellExecution=rm',
    ]);
    await run(cursor, [
      'cursor',
      'plugin',
      'export',
      '--out',
      exportedWithMatcher,
      '--matcher',
      'beforeReadFile=.*secret.*',
      '--matcher',
      'beforeShellExecution=rm|sudo',
    ]);
    await run(cursor, [
      'cursor',
      'plugin',
      'install',
      '--cwd',
      project,
      '--target',
      installed,
      '--matcher',
      'beforeShellExecution=rm',
      '--runtime-api-key',
      runtimeKey,
      '--core-url',
      coreUrl,
      '--approval-mode',
      'remote',
      '--governance-timeout',
      '18',
      '--hitl-max-wait',
      '90',
      '--hitl-poll-interval',
      '4',
    ]);
    expectRuntimeConfig(join(project, '.cursor-hooks', 'config.json'), runtimeKey, coreUrl, 'remote');
    await run(cursor, [
      'cursor',
      'plugin',
      'install',
      '--cwd',
      project,
      '--target',
      symlinked,
      '--symlink',
      exportedWithMatcher,
      '--matcher',
      'beforeReadFile=.*secret.*',
    ]);
    await run(cursor, [
      'cursor',
      'doctor',
      '--cwd',
      project,
      '--plugin-target',
      installed,
      '--surface-only',
      '--json',
    ]);
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
      writable: true,
    });
    await run(cursor, [
      'cursor',
      'doctor',
      '--cwd',
      project,
      '--plugin-target',
      installed,
      '--surface-only',
    ]);
    await run(cursor, ['cursor', 'plugin', 'uninstall', '--cwd', project, '--target', installed]);
    await run(cursor, ['cursor', 'plugin', 'uninstall', '--cwd', project, '--target', symlinked]);
  });

  it('claude-code command actions install and uninstall scoped surfaces', async () => {
    const claude = programWith(registerClaudeCodeCommands);
    const runtimeKey = `obx_test_${'f'.repeat(48)}`;
    const coreUrl = 'http://127.0.0.1:8086';
    const exported = join(project, 'exported-claude-plugin');
    const exportedWithMatcher = join(project, 'exported-claude-plugin-matcher');
    const target = join(project, 'claude-plugin-target');

    await run(claude, ['claude-code', 'plugin', 'export', '--out', exported]);
    await run(claude, [
      'claude-code',
      'plugin',
      'export',
      '--out',
      exportedWithMatcher,
      '--matcher',
      'PreToolUse=Bash|Write',
      '--include-opt-in-hooks',
    ]);
    await run(claude, ['claude-code', 'plugin', 'install', '--scope', 'project', '--cwd', project, '--symlink', exported]);
    await run(claude, [
      'claude-code',
      'plugin',
      'install',
      '--scope',
      'project',
      '--cwd',
      project,
      '--target',
      target,
      '--symlink',
      exportedWithMatcher,
      '--matcher',
      'PreToolUse=Bash|Write',
      '--include-opt-in-hooks',
      '--runtime-api-key',
      runtimeKey,
      '--core-url',
      coreUrl,
      '--approval-mode',
      'defer',
      '--governance-timeout',
      '18',
      '--hitl-max-wait',
      '90',
      '--hitl-poll-interval',
      '4',
    ]);
    expectRuntimeConfig(join(project, '.claude-hooks', 'config.json'), runtimeKey, coreUrl, 'defer');
    await run(claude, [
      'claude-code',
      'doctor',
      '--cwd',
      project,
      '--plugin-target',
      target,
      '--surface-only',
      '--include-opt-in-hooks',
      '--json',
    ]);
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
      writable: true,
    });
    await run(claude, [
      'claude-code',
      'doctor',
      '--cwd',
      project,
      '--plugin-target',
      target,
      '--surface-only',
      '--include-opt-in-hooks',
    ]);
    await run(claude, ['claude-code', 'plugin', 'uninstall', '--scope', 'project', '--cwd', project]);
    await run(claude, ['claude-code', 'plugin', 'uninstall', '--scope', 'project', '--cwd', project, '--target', target]);
  });

  it('skill command actions expose and install project-local skill surfaces', async () => {
    const skill = programWith(registerSkillCommands);

    await run(skill, ['skill', 'path']);

    const claudeTarget = installSkill({ cwd: project });
    const cursorTarget = installSkill({ cwd: project, cursor: true });
    const explicitTarget = installSkill({ target: join(project, 'custom-skill') });

    expect(existsSync(join(claudeTarget, 'SKILL.md'))).toBe(true);
    expect(claudeTarget).toBe(join(project, '.claude', 'skills', 'openbox'));
    expect(existsSync(join(cursorTarget, 'SKILL.md'))).toBe(true);
    expect(cursorTarget).toBe(join(project, '.cursor', 'skills', 'openbox'));
    expect(existsSync(join(explicitTarget, 'references', 'claude-code-governance.md'))).toBe(true);
  });

  it('integration command actions reject invalid scopes and matcher pairs', async () => {
    const cursor = programWith(registerCursorCommands);
    const claude = programWith(registerClaudeCodeCommands);

    await expect(run(cursor, ['cursor', 'plugin', 'install', '--matcher', 'missing-equals'])).rejects.toThrow();
    await expect(run(claude, ['claude-code', 'plugin', 'install', '--scope', 'workspace'])).rejects.toThrow();
    await expect(run(claude, ['claude-code', 'plugin', 'uninstall', '--scope', 'workspace'])).rejects.toThrow();
    await expect(run(claude, ['claude-code', 'plugin', 'install', '--scope', 'global'])).rejects.toThrow();
  });
});
