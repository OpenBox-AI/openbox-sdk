import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let home: string;
let cwd: string;
let oldHome: string | undefined;

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf-8');
}

function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function installUserCursorSurfaces(): void {
  for (const file of [
    'openbox-check.md',
    'openbox-doctor.md',
    'openbox-list-agents.md',
    'openbox-pending.md',
    'openbox-status.md',
  ]) {
    fs.mkdirSync(path.join(home, '.cursor', 'commands'), { recursive: true });
    fs.writeFileSync(path.join(home, '.cursor', 'commands', file), '# test\n');
  }
  fs.mkdirSync(path.join(home, '.cursor', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cursor', 'rules', 'openbox.mdc'), 'rules\n');
  fs.mkdirSync(path.join(home, '.cursor', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cursor', 'agents', 'openbox-reviewer.md'), 'agent\n');
  fs.mkdirSync(path.join(home, '.cursor', 'skills', 'openbox'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cursor', 'skills', 'openbox', 'SKILL.md'), 'skill\n');
  fs.mkdirSync(path.join(home, '.cursor', 'extensions', 'openbox.openbox-0.1.0'), { recursive: true });
  writeJson(path.join(home, '.cursor', 'extensions', 'openbox.openbox-0.1.0', 'package.json'), {
    name: 'openbox',
    publisher: 'openbox',
    version: '0.1.0',
  });
}

beforeEach(() => {
  vi.resetModules();
  oldHome = process.env.HOME;
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'openbox-home-'));
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'openbox-project-'));
  process.env.HOME = home;
});

afterEach(() => {
  if (oldHome === undefined) delete process.env.HOME;
  else process.env.HOME = oldHome;
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(cwd, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('runtime/cursor/install; source-level verification', () => {
  it('installs matcher-scoped hooks and reports missing MCP/user surfaces', async () => {
    const { installCursor, verifyCursorInstall } = await import('../../ts/src/runtime/cursor/install.ts');

    installCursor({ matchers: { beforeShellExecution: '\\b(rm|curl)\\b' } });

    const hooks = readJson(path.join(home, '.cursor', 'hooks.json')).hooks;
    expect(hooks.beforeShellExecution[0]).toMatchObject({
      command: 'openbox cursor hook',
      timeout: 1800,
      matcher: '\\b(rm|curl)\\b',
    });

    const checks = verifyCursorInstall();
    expect(checks.find((c) => c.name === 'hooks')?.status).toBe('pass');
    expect(checks.find((c) => c.name === 'mcp')?.status).toBe('fail');
    expect(checks.find((c) => c.name === 'slash-commands')?.detail).toContain('directory missing');
  });

  it('passes every global check when hooks, MCP, commands, rules, agents, and skill exist', async () => {
    const { installCursor, verifyCursorInstall } = await import('../../ts/src/runtime/cursor/install.ts');

    installCursor();
    writeJson(path.join(home, '.cursor', 'mcp.json'), {
      mcpServers: { openbox: { command: 'openbox', args: ['mcp', 'serve'] } },
    });
    installUserCursorSurfaces();

    expect(verifyCursorInstall().map((c) => [c.name, c.status])).toEqual([
      ['hooks', 'pass'],
      ['mcp', 'pass'],
      ['extension', 'pass'],
      ['slash-commands', 'pass'],
      ['rules', 'pass'],
      ['agents', 'pass'],
      ['skill', 'pass'],
    ]);
  });

  it('runtime readiness fails stale hook config states and passes valid format when core validation is disabled', async () => {
    const { installCursor, verifyCursorInstall } = await import('../../ts/src/runtime/cursor/install.ts');

    installCursor();
    writeJson(path.join(home, '.cursor-hooks', 'config.json'), {});
    let checks = await verifyCursorInstall({ includeRuntime: true });
    expect(checks.find((c) => c.name === 'runtime')?.detail).toContain('missing OPENBOX_API_KEY');

    writeJson(path.join(home, '.cursor-hooks', 'config.json'), {
      OPENBOX_API_KEY: 'obx_live_YOUR_API_KEY_HERE',
    });
    checks = await verifyCursorInstall({ includeRuntime: true });
    expect(checks.find((c) => c.name === 'runtime')?.detail).toContain('placeholder OPENBOX_API_KEY');

    writeJson(path.join(home, '.cursor-hooks', 'config.json'), {
      OPENBOX_API_KEY: 'not-a-key',
    });
    checks = await verifyCursorInstall({ includeRuntime: true });
    expect(checks.find((c) => c.name === 'runtime')?.detail).toContain('invalid OPENBOX_API_KEY format');

    writeJson(path.join(home, '.cursor-hooks', 'config.json'), {
      OPENBOX_API_KEY: `obx_test_${'a'.repeat(48)}`,
      DRY_RUN: true,
    });
    checks = await verifyCursorInstall({ includeRuntime: true });
    expect(checks.find((c) => c.name === 'runtime')?.detail).toContain('DRY_RUN=true');

    writeJson(path.join(home, '.cursor-hooks', 'config.json'), {
      OPENBOX_API_KEY: `obx_test_${'a'.repeat(48)}`,
      OPENBOX_CORE_URL: 'http://127.0.0.1:8086',
    });
    checks = await verifyCursorInstall({ includeRuntime: true });
    const runtime = checks.find((c) => c.name === 'runtime')!;
    expect(runtime.status).toBe('pass');
    expect(runtime.detail).toContain('key=format-ok');
  });

  it('runtime readiness fails when core validation rejects the runtime key', async () => {
    const { installCursor, verifyCursorInstall } = await import('../../ts/src/runtime/cursor/install.ts');

    installCursor();
    writeJson(path.join(home, '.cursor-hooks', 'config.json'), {
      OPENBOX_API_KEY: `obx_test_${'b'.repeat(48)}`,
      OPENBOX_CORE_URL: 'http://core-fail.local',
    });
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ error: 'bad runtime key' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const checks = await verifyCursorInstall({ includeRuntime: true, validateRuntime: true });
    const runtime = checks.find((c) => c.name === 'runtime')!;
    expect(runtime.status).toBe('fail');
    expect(runtime.detail).toContain('core validation failed');
    expect(runtime.detail).toContain('401');
  });

  it('reports hook command drift and timeout drift with concrete details', async () => {
    const { installCursor, verifyCursorInstall } = await import('../../ts/src/runtime/cursor/install.ts');

    installCursor();
    const hooksFile = path.join(home, '.cursor', 'hooks.json');
    const hooksJson = readJson(hooksFile);
    hooksJson.hooks.beforeSubmitPrompt[0].command = 'openbox old hook';
    hooksJson.hooks.beforeReadFile[0].timeout = 60;
    writeJson(hooksFile, hooksJson);

    const hooks = verifyCursorInstall().find((c) => c.name === 'hooks')!;
    expect(hooks.status).toBe('fail');
    expect(hooks.detail).toContain('beforeSubmitPrompt: command drift');
    expect(hooks.detail).toContain('beforeReadFile: timeout 60 != 1800');
  });

  it('project-scoped verification skips user surfaces and uninstall removes hooks', async () => {
    const { installCursor, uninstallCursor, verifyCursorInstall } = await import('../../ts/src/runtime/cursor/install.ts');

    installCursor({ scope: 'project', cwd });
    writeJson(path.join(cwd, '.cursor', 'mcp.json'), {
      mcpServers: { openbox: { command: 'openbox', args: ['mcp', 'serve'] } },
    });

    const checks = verifyCursorInstall({ scope: 'project', cwd });
    expect(checks.map((c) => [c.name, c.status])).toEqual([
      ['hooks', 'pass'],
      ['mcp', 'pass'],
      ['user-surfaces', 'skip'],
    ]);

    uninstallCursor({ scope: 'project', cwd });
    expect(readJson(path.join(cwd, '.cursor', 'hooks.json')).hooks).toBeUndefined();
  });
});

describe('runtime/mcp/install; host and error states', () => {
  it('installs and uninstalls the global Cursor MCP entry without touching other servers', async () => {
    const { installMcp, uninstallMcp } = await import('../../ts/src/runtime/mcp/install.ts');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const file = path.join(home, '.cursor', 'mcp.json');
    writeJson(file, { mcpServers: { keep: { command: 'keep' } } });

    installMcp({ targets: ['cursor'] });
    expect(readJson(file).mcpServers).toMatchObject({
      keep: { command: 'keep' },
      openbox: { command: 'openbox', args: ['mcp', 'serve'] },
    });

    uninstallMcp({ targets: ['cursor'] });
    expect(readJson(file).mcpServers).toEqual({ keep: { command: 'keep' } });
  });

  it('covers missing config and no-openbox uninstall states', async () => {
    const { uninstallMcp } = await import('../../ts/src/runtime/mcp/install.ts');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line?: unknown) => {
      logs.push(String(line ?? ''));
    });

    uninstallMcp({ targets: ['cursor'] });
    writeJson(path.join(home, '.cursor', 'mcp.json'), { mcpServers: { other: { command: 'x' } } });
    uninstallMcp({ targets: ['cursor'] });

    expect(logs.some((line) => line.includes('not present'))).toBe(true);
    expect(logs.some((line) => line.includes('no openbox entry found'))).toBe(true);
  });

  it('writes project-scoped Cursor MCP and rejects unsupported Claude Desktop project scope', async () => {
    const { installMcp } = await import('../../ts/src/runtime/mcp/install.ts');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    installMcp({ targets: ['cursor'], scope: 'project', cwd });
    expect(readJson(path.join(cwd, '.cursor', 'mcp.json')).mcpServers.openbox).toEqual({
      command: 'openbox',
      args: ['mcp', 'serve'],
    });

    expect(() =>
      installMcp({ targets: ['claude-desktop'], scope: 'project', cwd }),
    ).toThrow('scope `project` is not supported for claude-desktop');
  });

  it('refuses to overwrite malformed host JSON', async () => {
    const { installMcp } = await import('../../ts/src/runtime/mcp/install.ts');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const file = path.join(home, '.cursor', 'mcp.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{not-json', 'utf-8');

    expect(() => installMcp({ targets: ['cursor'] })).toThrow('Refusing to overwrite malformed JSON');
  });
});

describe('install/from-spec; MCP entry helpers', () => {
  it('installs, replaces, removes, and no-ops scoped MCP entries', async () => {
    const { INSTALL_SPEC } = await import('../../ts/src/core-client/generated/runtime/cursor.js');
    const { installMcpEntry, uninstallMcpEntry } = await import('../../ts/src/install/from-spec.ts');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const first = installMcpEntry(
      INSTALL_SPEC,
      'openbox',
      { command: 'openbox', args: ['mcp', 'serve'] },
      { scope: 'project', cwd },
    );
    expect(first).toBe(path.join(cwd, '.cursor', 'mcp.json'));
    expect(readJson(first).mcpServers.openbox).toEqual({
      command: 'openbox',
      args: ['mcp', 'serve'],
    });

    installMcpEntry(
      INSTALL_SPEC,
      'openbox',
      { command: 'node', args: ['dist/cli/index.js', 'mcp', 'serve'] },
      { scope: 'project', cwd },
    );
    expect(readJson(first).mcpServers.openbox.command).toBe('node');

    expect(uninstallMcpEntry(INSTALL_SPEC, 'missing', { scope: 'project', cwd })).toBe(first);
    uninstallMcpEntry(INSTALL_SPEC, 'openbox', { scope: 'project', cwd });
    expect(readJson(first).mcpServers).toBeUndefined();
  });

  it('resolves local/project/global scope edges', async () => {
    const { resolveInstallPaths } = await import('../../ts/src/install/from-spec.ts');
    const claudeSpec = {
      file: '~/.claude/settings.json',
      key: 'hooks',
      style: 'claude-array' as const,
      command: 'openbox claude-code hook',
      configDir: '~/.claude-hooks',
      events: [{ name: 'PreToolUse' }],
    };
    const cursorSpec = {
      file: '~/.cursor/hooks.json',
      key: 'hooks',
      style: 'cursor-keyed' as const,
      command: 'openbox cursor hook',
      configDir: '~/.cursor-hooks',
      events: [{ name: 'beforeSubmitPrompt' }],
    };

    expect(resolveInstallPaths(claudeSpec, { scope: 'local', cwd }).hooksFile).toBe(
      path.join(cwd, '.claude', 'settings.local.json'),
    );
    expect(resolveInstallPaths(cursorSpec).mcpFile).toBe(path.join(home, '.cursor', 'mcp.json'));
    expect(() => resolveInstallPaths(cursorSpec, { scope: 'local', cwd })).toThrow(
      'scope `local` is not supported for cursor-keyed installs',
    );
  });
});

describe('runtime/cursor public path and session wrappers', () => {
  it('exports the hook log path and forwards session lifecycle keys', async () => {
    const runtime = await import('../../ts/src/runtime/cursor/index.ts');
    expect(runtime.HOOK_LOG_PATH).toContain('cursor');

    const { resolveSession, markHalted, clearSession } = await import('../../ts/src/runtime/cursor/session-resolver.ts');
    const cfg: any = {
      sessionDir: path.join(home, 'sessions'),
      idleTimeoutMs: 1000,
      taskQueue: 'cursor-hooks',
    };
    const session = await resolveSession({ conversation_id: 'conversation-1' } as any, cfg);
    expect(session.workflowId).toMatch(/[0-9a-f-]{36}/);
    expect(session.runId).toMatch(/[0-9a-f-]{36}/);
    expect(() => markHalted('conversation-1', cfg)).not.toThrow();
    expect(() => clearSession('conversation-1', cfg)).not.toThrow();
  });
});

describe('runtime/mcp/config; cwd token and deferred credential paths', () => {
  it('prefers cwd .tokens when no explicit tokens path is supplied', async () => {
    const beforeCwd = process.cwd();
    const beforeEnv = { ...process.env };
    process.chdir(cwd);
    fs.writeFileSync(path.join(cwd, '.tokens'), 'API_KEY=obx_key_cwd\n', 'utf-8');
    try {
      const { readTokens } = await import('../../ts/src/runtime/mcp/config.ts');
      expect(readTokens().apiKey).toBe('obx_key_cwd');
    } finally {
      process.chdir(beforeCwd);
      process.env = beforeEnv;
    }
  });

  it('defers missing-token failures until the first API call and sends request bodies', async () => {
    const beforeEnv = { ...process.env };
    process.env.OPENBOX_API_URL = 'http://localhost:18080';
    const missing = path.join(cwd, 'missing-tokens');
    try {
      const { createApi, setMcpClientName } = await import('../../ts/src/runtime/mcp/config.ts');
      const api = createApi({ tokensPath: missing });
      await expect(api('/x')).rejects.toThrow('No tokens at');

      const tokens = path.join(cwd, 'tokens');
      fs.writeFileSync(tokens, 'API_KEY=obx_key_body\n', 'utf-8');
      let seen: any;
      vi.stubGlobal('fetch', async (url: string, init: any) => {
        seen = { url, init };
        return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
      });
      setMcpClientName('cursor-chat');
      await createApi({ tokensPath: tokens })('/body', 'POST', { a: 1 });
      expect(seen.url).toBe('http://localhost:18080/body');
      expect(seen.init.method).toBe('POST');
      expect(seen.init.body).toBe(JSON.stringify({ a: 1 }));
      expect(seen.init.headers['X-Openbox-Client']).toBe('runtime/mcp/cursor-chat');
    } finally {
      vi.unstubAllGlobals();
      process.env = beforeEnv;
    }
  });
});
