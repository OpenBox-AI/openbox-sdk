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
  runtimeKey: string,
  coreUrl: string,
  approvalMode: string,
  identity?: { did: string; privateKey: string },
): void {
  const env = readDotenv(join(project, '.openbox', 'cursor', '.env'));
  expect(env.OPENBOX_API_KEY).toBe(runtimeKey);
  expect(env.OPENBOX_CORE_URL).toBe(coreUrl);
  if (identity) {
    expect(env.OPENBOX_AGENT_DID).toBe(identity.did);
    expect(env.OPENBOX_AGENT_PRIVATE_KEY).toBe(identity.privateKey);
  }

  const config = readJson(join(project, '.openbox', 'cursor', 'config.json'));
  expect(config.approvalMode).toBe(approvalMode);
  expect(config.governanceTimeout).toBe('18');
  expect(config.hitlMaxWait).toBe(90);
  expect(config.hitlPollInterval).toBe(4);
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
  expect(config.governanceTimeout).toBe('18');
  expect(config.hitlMaxWait).toBe(90);
  expect(config.hitlPollInterval).toBe(4);
  expect(config.OPENBOX_API_KEY).toBeUndefined();
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
    const goodKey = 'obx_key_' + 'c'.repeat(48);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await run(auth, ['auth', 'clear-api-key']);
      await run(auth, ['auth', 'status']);
      await expect(run(auth, ['auth', 'set-api-key', '--key', 'bad-key'])).rejects.toThrow();
      await run(auth, ['auth', 'set-api-key', '--key', goodKey]);
      await run(auth, ['auth', 'status']);
      await run(auth, ['auth', 'profile']);
      await run(auth, ['auth', 'permissions']);

      const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      // set-api-key actually persisted the validated org key to the on-disk
      // store (the bad-key attempt above did not, having been rejected).
      const { getTokenPath } = await import('../../ts/src/cli/config.ts');
      expect(readFileSync(getTokenPath(), 'utf-8')).toContain(goodKey);
      // status reported a saved key (never "none") while a key is present.
      expect(out).toContain('api-key (');
      expect(out).not.toContain('\nnone');
      // profile fetched /auth/profile and printed the backend identity.
      expect(out).toContain('org-dev');
      expect(out).toContain('dev@example.test');
      // permissions printed an explicit (empty) JSON permission set.
      expect(out).toContain('[]');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('cursor command actions export/install/inspect/uninstall the plugin surface', async () => {
    const cursor = programWith(registerCursorCommands);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const runtimeKey = `obx_test_${'e'.repeat(48)}`;
    const coreUrl = 'http://127.0.0.1:8086';
    const identity = {
      did: 'did:aip:550e8400-e29b-41d4-a716-446655440000',
      privateKey: Buffer.alloc(32, 1).toString('base64'),
    };
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
      '--agent-did',
      identity.did,
      '--agent-private-key',
      identity.privateKey,
      '--approval-mode',
      'remote',
      '--governance-timeout',
      '18',
      '--hitl-max-wait',
      '90',
      '--hitl-poll-interval',
      '4',
    ]);
    expectRuntimeConfig(project, runtimeKey, coreUrl, 'remote', identity);
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

    const logLines = logSpy.mock.calls.map((c) => c.join(' '));
    logSpy.mockRestore();

    // export wrote a real, marketplace-shaped plugin folder, and the
    // --matcher pairs were baked into hooks/hooks.json verbatim.
    expect(existsSync(join(exported, '.cursor-plugin', 'plugin.json'))).toBe(true);
    const exportedHooks = readJson(join(exported, 'hooks', 'hooks.json')) as any;
    expect(exportedHooks.hooks.beforeShellExecution[0].matcher).toBe('rm');
    const matcherHooks = readJson(join(exportedWithMatcher, 'hooks', 'hooks.json')) as any;
    expect(matcherHooks.hooks.beforeReadFile[0].matcher).toBe('.*secret.*');
    expect(matcherHooks.hooks.beforeShellExecution[0].matcher).toBe('rm|sudo');

    // the --json doctor run reported the installed surface with zero failures.
    const doctorJson = logLines
      .map((l) => {
        try {
          return JSON.parse(l) as { checks?: any[]; summary?: { fail?: number } };
        } catch {
          return undefined;
        }
      })
      .find((v) => v && Array.isArray(v.checks) && v.summary);
    expect(doctorJson).toBeDefined();
    expect(doctorJson!.summary!.fail).toBe(0);
    expect(doctorJson!.checks!.every((c: any) => c.status !== 'fail')).toBe(true);
    expect(
      doctorJson!.checks!.some((c: any) => c.name === 'plugin' && c.status === 'pass'),
    ).toBe(true);

    // uninstall removed exactly the targeted plugin dirs (both the exported
    // copy and the symlink), while the standalone export folders survive.
    expect(existsSync(installed)).toBe(false);
    expect(existsSync(symlinked)).toBe(false);
    expect(existsSync(exported)).toBe(true);
  });

  it('claude-code command actions install and uninstall scoped surfaces', async () => {
    const claude = programWith(registerClaudeCodeCommands);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const runtimeKey = `obx_test_${'f'.repeat(48)}`;
    const coreUrl = 'http://127.0.0.1:8086';
    const identity = {
      did: 'did:aip:550e8400-e29b-41d4-a716-446655440001',
      privateKey: Buffer.alloc(32, 2).toString('base64'),
    };
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
      '--agent-did',
      identity.did,
      '--agent-private-key',
      identity.privateKey,
      '--approval-mode',
      'defer',
      '--governance-timeout',
      '18',
      '--hitl-max-wait',
      '90',
      '--hitl-poll-interval',
      '4',
    ]);
    expectClaudeRuntimeConfig(project, runtimeKey, coreUrl, 'defer', identity);
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

    const logLines = logSpy.mock.calls.map((c) => c.join(' '));
    logSpy.mockRestore();

    // export wrote a Claude-shaped plugin folder; the --matcher landed in the
    // PreToolUse hook entry (matcher is a sibling of the hook handler array).
    expect(existsSync(join(exported, '.claude-plugin', 'plugin.json'))).toBe(true);
    const matcherHooks = readJson(join(exportedWithMatcher, 'hooks', 'hooks.json')) as any;
    expect(matcherHooks.hooks.PreToolUse[0].matcher).toBe('Bash|Write');

    // the --json doctor run reported the installed surface with zero failures.
    const doctorJson = logLines
      .map((l) => {
        try {
          return JSON.parse(l) as { checks?: any[]; summary?: { fail?: number } };
        } catch {
          return undefined;
        }
      })
      .find((v) => v && Array.isArray(v.checks) && v.summary);
    expect(doctorJson).toBeDefined();
    expect(doctorJson!.summary!.fail).toBe(0);
    expect(doctorJson!.checks!.every((c: any) => c.status !== 'fail')).toBe(true);
    expect(
      doctorJson!.checks!.some((c: any) => c.name === 'plugin' && c.status === 'pass'),
    ).toBe(true);

    // both uninstalls removed their scoped surfaces: the default
    // .claude/skills/openbox dir and the explicit --target dir.
    expect(existsSync(target)).toBe(false);
    expect(existsSync(join(project, '.claude', 'skills', 'openbox'))).toBe(false);
    expect(existsSync(join(exported, '.claude-plugin'))).toBe(true);
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
