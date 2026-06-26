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

function writeEnv(file: string, values: Record<string, string>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    Object.entries(values)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join('\n') + '\n',
    'utf-8',
  );
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
  it('verifies the plugin-only Cursor surface and never writes direct Cursor hooks or MCP files', async () => {
    const { installCursorPlugin, verifyCursorInstall } = await import('../../ts/src/runtime/cursor/index.ts');

    installCursorPlugin({ cwd, matchers: { beforeShellExecution: '\\b(rm|curl)\\b' } });

    const pluginDir = path.join(cwd, '.cursor', 'plugins', 'local', 'openbox');
    const hooks = readJson(path.join(pluginDir, 'hooks', 'hooks.json')).hooks;
    expect(hooks.beforeShellExecution[0]).toMatchObject({
      command: './.openbox/bin/openbox cursor hook',
      timeout: 1800,
      matcher: '\\b(rm|curl)\\b',
    });
    expect(fs.existsSync(path.join(home, '.cursor', 'hooks.json'))).toBe(false);
    expect(fs.existsSync(path.join(home, '.cursor', 'mcp.json'))).toBe(false);
    expect(fs.existsSync(path.join(cwd, '.openbox', 'cursor', 'config.json'))).toBe(true);
    expect(readJson(path.join(cwd, '.openbox', 'cursor', 'config.json'))).toEqual({
      hitlEnabled: true,
      hitlMaxWait: 300,
      verbose: false,
    });

    expect(verifyCursorInstall({ cwd }).map((c) => [c.name, c.status])).toEqual([
      ['plugin', 'pass'],
      ['plugin-manifest', 'pass'],
      ['plugin-marketplace', 'pass'],
      ['plugin-workspace-open', 'pass'],
      ['plugin-skill', 'pass'],
      ['plugin-commands', 'pass'],
      ['plugin-rules', 'pass'],
      ['plugin-agents', 'pass'],
      ['plugin-hooks', 'pass'],
      ['plugin-mcp', 'pass'],
      ['openbox-runtime', 'pass'],
    ]);
  });

  it('runtime readiness fails incomplete runtime env states and passes valid format when core validation is disabled', async () => {
    const { installCursorPlugin, verifyCursorInstall } = await import('../../ts/src/runtime/cursor/index.ts');

    installCursorPlugin({ cwd });
    let checks = await verifyCursorInstall({ cwd, includeRuntime: true });
    expect(checks.find((c) => c.name === 'runtime')?.detail).toContain('missing OPENBOX_API_KEY');

    writeEnv(path.join(cwd, '.openbox', 'cursor', '.env'), {
      OPENBOX_API_KEY: 'obx_live_YOUR_API_KEY_HERE',
    });
    checks = await verifyCursorInstall({ cwd, includeRuntime: true });
    expect(checks.find((c) => c.name === 'runtime')?.detail).toContain('placeholder OPENBOX_API_KEY');

    writeEnv(path.join(cwd, '.openbox', 'cursor', '.env'), {
      OPENBOX_API_KEY: 'not-a-key',
    });
    checks = await verifyCursorInstall({ cwd, includeRuntime: true });
    expect(checks.find((c) => c.name === 'runtime')?.detail).toContain('invalid OPENBOX_API_KEY format');

    writeEnv(path.join(cwd, '.openbox', 'cursor', '.env'), {
      OPENBOX_API_KEY: `obx_test_${'a'.repeat(48)}`,
      OPENBOX_CORE_URL: 'http://127.0.0.1:8086',
    });
    checks = await verifyCursorInstall({ cwd, includeRuntime: true });
    const runtime = checks.find((c) => c.name === 'runtime')!;
    expect(runtime.status).toBe('pass');
    expect(runtime.detail).toContain('key=format-ok');
  });

  it('runtime readiness fails when core validation rejects the runtime key', async () => {
    const { installCursorPlugin, verifyCursorInstall } = await import('../../ts/src/runtime/cursor/index.ts');

    installCursorPlugin({ cwd });
    writeEnv(path.join(cwd, '.openbox', 'cursor', '.env'), {
      OPENBOX_API_KEY: `obx_test_${'b'.repeat(48)}`,
      OPENBOX_CORE_URL: 'http://core-fail.local',
    });
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ error: 'bad runtime key' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const checks = await verifyCursorInstall({ cwd, includeRuntime: true, validateRuntime: true });
    const runtime = checks.find((c) => c.name === 'runtime')!;
    expect(runtime.status).toBe('fail');
    expect(runtime.detail).toContain('core validation failed');
    expect(runtime.detail).toContain('401');
  });
});

describe('runtime/mcp/install; host and error states', () => {
  it('installs and uninstalls the project Cursor MCP entry without touching other servers', async () => {
    const { installMcp, uninstallMcp } = await import('../../ts/src/runtime/mcp/install.ts');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const file = path.join(cwd, '.cursor', 'mcp.json');
    writeJson(file, { mcpServers: { keep: { command: 'keep' } } });

    installMcp({ targets: ['cursor'], cwd });
    expect(readJson(file).mcpServers).toMatchObject({
      keep: { command: 'keep' },
      openbox: { command: './.openbox/bin/openbox', args: ['mcp', 'serve'] },
    });
    expect(fs.existsSync(path.join(home, '.cursor', 'mcp.json'))).toBe(false);

    uninstallMcp({ targets: ['cursor'], cwd });
    expect(readJson(file).mcpServers).toEqual({ keep: { command: 'keep' } });
  });

  it('covers missing config and no-openbox uninstall states', async () => {
    const { uninstallMcp } = await import('../../ts/src/runtime/mcp/install.ts');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line?: unknown) => {
      logs.push(String(line ?? ''));
    });

    uninstallMcp({ targets: ['cursor'], cwd });
    writeJson(path.join(cwd, '.cursor', 'mcp.json'), { mcpServers: { other: { command: 'x' } } });
    uninstallMcp({ targets: ['cursor'], cwd });

    expect(logs.some((line) => line.includes('not present'))).toBe(true);
    expect(logs.some((line) => line.includes('no openbox entry found'))).toBe(true);
  });

  it('writes project-scoped Cursor MCP and rejects non-project scope', async () => {
    const { installMcp } = await import('../../ts/src/runtime/mcp/install.ts');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    installMcp({ targets: ['cursor'], scope: 'project', cwd });
    expect(readJson(path.join(cwd, '.cursor', 'mcp.json')).mcpServers.openbox).toEqual({
      command: './.openbox/bin/openbox',
      args: ['mcp', 'serve'],
    });

    expect(() => installMcp({ targets: ['cursor'], scope: 'global' as never, cwd })).toThrow(
      'scope `global` is not supported; expected project',
    );
  });

  it('writes project-scoped Codex MCP to .codex/config.toml', async () => {
    const { installMcp, uninstallMcp } = await import('../../ts/src/runtime/mcp/install.ts');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    installMcp({ targets: ['codex'], scope: 'project', cwd });
    const file = path.join(cwd, '.codex', 'config.toml');
    expect(fs.readFileSync(file, 'utf-8')).toContain('[mcp_servers.openbox]');
    expect(fs.existsSync(path.join(cwd, '.codex', 'mcp.json'))).toBe(false);

    uninstallMcp({ targets: ['codex'], scope: 'project', cwd });
    expect(fs.readFileSync(file, 'utf-8')).not.toContain('[mcp_servers.openbox]');
  });

  it('refuses to overwrite malformed host JSON', async () => {
    const { installMcp } = await import('../../ts/src/runtime/mcp/install.ts');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const file = path.join(cwd, '.cursor', 'mcp.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{not-json', 'utf-8');

    expect(() => installMcp({ targets: ['cursor'], cwd })).toThrow('Refusing to overwrite malformed JSON');
  });
});

describe('install/from-spec; MCP entry helpers', () => {
  it('installs, replaces, removes, and no-ops scoped MCP entries', async () => {
    const { HOOK_SPEC } = await import('../../ts/src/core-client/generated/runtime/cursor.js');
    const { installMcpEntry, uninstallMcpEntry } = await import('../../ts/src/install/from-spec.ts');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const first = installMcpEntry(
      HOOK_SPEC,
      'openbox',
      { command: 'openbox', args: ['mcp', 'serve'] },
      { scope: 'project', cwd },
    );
    expect(first).toBe(path.join(cwd, '.cursor', 'mcp.json'));
    expect(readJson(first).mcpServers.openbox).toEqual({
      command: './.openbox/bin/openbox',
      args: ['mcp', 'serve'],
    });

    installMcpEntry(
      HOOK_SPEC,
      'other',
      { command: 'openbox-local', args: ['mcp', 'serve'] },
      { scope: 'project', cwd },
    );
    expect(readJson(first).mcpServers.other.command).toBe('openbox-local');

    expect(uninstallMcpEntry(HOOK_SPEC, 'missing', { scope: 'project', cwd })).toBe(first);
    uninstallMcpEntry(HOOK_SPEC, 'openbox', { scope: 'project', cwd });
    expect(readJson(first).mcpServers.other.command).toBe('openbox-local');
    uninstallMcpEntry(HOOK_SPEC, 'other', { scope: 'project', cwd });
    expect(readJson(first).mcpServers).toBeUndefined();
  });

  it('resolves project scope and rejects non-project scopes', async () => {
    const { resolveInstallPaths } = await import('../../ts/src/install/from-spec.ts');
    const claudeSpec = {
      file: '.claude/settings.json',
      key: 'hooks',
      style: 'claude-array' as const,
      command: 'openbox claude-code hook',
      configDir: '.openbox/claude-code',
      events: [{ name: 'PreToolUse' }],
    };
    const cursorSpec = {
      file: '.cursor-plugin-test/hooks.json',
      key: 'hooks',
      style: 'cursor-keyed' as const,
      command: 'openbox cursor hook',
      configDir: '.openbox/cursor',
      events: [{ name: 'beforeSubmitPrompt' }],
    };

    expect(resolveInstallPaths(claudeSpec, { cwd }).hooksFile).toBe(
      path.join(cwd, '.claude', 'settings.json'),
    );
    expect(resolveInstallPaths(cursorSpec, { cwd }).mcpFile).toBe(path.join(cwd, '.cursor', 'mcp.json'));
    expect(resolveInstallPaths((await import('../../ts/src/core-client/generated/runtime/codex.js')).HOOK_SPEC, { cwd }).mcpFile).toBe(
      path.join(cwd, '.codex', 'config.toml'),
    );
    expect(() => resolveInstallPaths(cursorSpec, { scope: 'global' as never, cwd })).toThrow(
      'scope `global` is not supported; expected project',
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
      taskQueue: 'cursor',
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
      fs.writeFileSync(tokens, ['API_KEY=obx', '_key_body\n'].join(''), 'utf-8');
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
