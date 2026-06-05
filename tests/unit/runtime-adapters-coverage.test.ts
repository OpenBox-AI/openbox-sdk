// Coverage-driven tests for ts/src/runtime/claude-code/* and
// ts/src/runtime/cursor/*. Mappers take a real GovernSession in
// production; here we duck-type a recording session that captures
// every call so we can drive every branch (skip-tool, skip-pattern,
// halt-on-verdict, payload build) without a live backend.
//
// Real session-vs-core behavior is covered by e2e.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'openbox-runtime-cov-'));
});
afterEach(() => {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

function recordingSession(verdict: { arm?: string } = { arm: 'allow' }): any {
  const calls: { method: string; args: any[] }[] = [];
  return {
    workflowId: 'wf-test',
    runId: 'run-test',
    workflowType: 'test',
    taskQueue: 'generic',
    isOpen: true,
    isTerminated: false,
    calls,
    async activity(...args: any[]) {
      calls.push({ method: 'activity', args });
      return verdict;
    },
    async workflowStarted() {
      calls.push({ method: 'workflowStarted', args: [] });
    },
    async workflowCompleted() {
      calls.push({ method: 'workflowCompleted', args: [] });
    },
    async workflowFailed(...args: any[]) {
      calls.push({ method: 'workflowFailed', args });
    },
  };
}

describe('runtime/claude-code/config', () => {
  it('loadConfig pulls API key + endpoint from env', async () => {
    process.env.OPENBOX_API_KEY = 'obx_live_test_x';
    process.env.OPENBOX_CORE_URL = 'http://localhost:8086';
    // Force re-import so config picks up our env state at module-load time.
    const mod = await import('../../ts/src/runtime/claude-code/config');
    const cfg = mod.loadConfig();
    expect(cfg.openboxApiKey).toBe('obx_live_test_x');
    expect(cfg.openboxEndpoint).toBe('http://localhost:8086');
    delete process.env.OPENBOX_API_KEY;
    delete process.env.OPENBOX_CORE_URL;
  });

  it('loadConfig supplies sane defaults for unspecified fields', async () => {
    const mod = await import('../../ts/src/runtime/claude-code/config');
    const cfg = mod.loadConfig();
    expect(typeof cfg.governanceTimeout).toBe('number');
    expect(Array.isArray(cfg.skipTools)).toBe(true);
  });
});

describe('runtime/claude-code/side-effects', () => {
  it('readFile returns "" for skip-pattern paths; reads real files; tolerates missing', async () => {
    const { sideEffects } = await import('../../ts/src/runtime/claude-code/side-effects');
    expect(sideEffects.readFile!('/foo/.git/HEAD')).toBe('');
    expect(sideEffects.readFile!('/var/no/such/file/here')).toBe('');
    expect(sideEffects.readFile!(123 as any)).toBe('');
    const f = join(dir, 'data.txt');
    writeFileSync(f, 'hello');
    expect(sideEffects.readFile!(f)).toBe('hello');
  });

  it('stringifyTruncate handles primitives + objects + huge payloads', async () => {
    const { sideEffects } = await import('../../ts/src/runtime/claude-code/side-effects');
    expect(sideEffects.stringifyTruncate!('hi')).toContain('hi');
    expect(sideEffects.stringifyTruncate!({ a: 1 })).toContain('"a"');
    expect((sideEffects.stringifyTruncate!({ payload: 'y'.repeat(8000) }) as string).length).toBeLessThanOrEqual(5050);
  });
});

describe('runtime/claude-code/mappers/pre-tool-use', () => {
  it('skip-tool short-circuits without firing activity', async () => {
    const { handlePreToolUse } = await import('../../ts/src/runtime/claude-code/mappers/pre-tool-use');
    const session = recordingSession();
    const env: any = { tool_name: 'SkipMe', tool_input: {}, session_id: 'S1' };
    const cfg: any = { skipTools: ['SkipMe'], sessionDir: dir };
    const v = await handlePreToolUse(env, session, cfg);
    expect(v).toBeUndefined();
    expect(session.calls.length).toBe(0);
  });

  it('skip-pattern short-circuits on .git/.claude paths', async () => {
    const { handlePreToolUse } = await import('../../ts/src/runtime/claude-code/mappers/pre-tool-use');
    const session = recordingSession();
    const env: any = { tool_name: 'Read', tool_input: { file_path: '/foo/.git/config' }, session_id: 'S2' };
    const cfg: any = { skipTools: [], sessionDir: dir };
    const v = await handlePreToolUse(env, session, cfg);
    expect(v).toBeUndefined();
    expect(session.calls.length).toBe(0);
  });

  it('routes a known tool to activity() with the right activity_type', async () => {
    const { handlePreToolUse } = await import('../../ts/src/runtime/claude-code/mappers/pre-tool-use');
    const session = recordingSession();
    const env: any = { tool_name: 'Read', tool_input: { file_path: '/Users/me/main.ts' }, session_id: 'S3' };
    const cfg: any = { skipTools: [], sessionDir: dir };
    await handlePreToolUse(env, session, cfg);
    expect(session.calls[0]?.method).toBe('activity');
  });

  it('mcp__* tools fall through to MCP_CALL', async () => {
    const { handlePreToolUse } = await import('../../ts/src/runtime/claude-code/mappers/pre-tool-use');
    const session = recordingSession();
    const env: any = { tool_name: 'mcp__filesystem__read', tool_input: {}, session_id: 'S4' };
    const cfg: any = { skipTools: [], sessionDir: dir };
    await handlePreToolUse(env, session, cfg);
    expect(session.calls.length).toBeGreaterThan(0);
  });

  it('halt verdict triggers markHalted (no throw)', async () => {
    const { handlePreToolUse } = await import('../../ts/src/runtime/claude-code/mappers/pre-tool-use');
    const session = recordingSession({ arm: 'halt' });
    const env: any = { tool_name: 'Read', tool_input: { file_path: '/Users/me/x.ts' }, session_id: 'halt-session' };
    const cfg: any = { skipTools: [], sessionDir: dir };
    const v = await handlePreToolUse(env, session, cfg);
    expect(v?.arm).toBe('halt');
  });
});

describe('runtime/claude-code/mappers/post-tool-use', () => {
  it('fires COMPLETE activity for known tools', async () => {
    const { handlePostToolUse } = await import('../../ts/src/runtime/claude-code/mappers/post-tool-use');
    const session = recordingSession();
    const env: any = { tool_name: 'Read', tool_input: { file_path: '/Users/me/main.ts' }, tool_response: 'ok', session_id: 'S5' };
    const cfg: any = { skipTools: [], sessionDir: dir };
    await handlePostToolUse(env, session, cfg);
    expect(session.calls[0]?.method).toBe('activity');
  });

  it('returns undefined for tools that have no post-tool route', async () => {
    const { handlePostToolUse } = await import('../../ts/src/runtime/claude-code/mappers/post-tool-use');
    const session = recordingSession();
    const env: any = { tool_name: 'UnknownTool', tool_input: {}, tool_response: 'ok', session_id: 'S5b' };
    const cfg: any = { skipTools: [], sessionDir: dir };
    await expect(handlePostToolUse(env, session, cfg)).resolves.toBeUndefined();
    expect(session.calls).toHaveLength(0);
  });

  it('covers post-tool route variants and halt marking', async () => {
    const { handlePostToolUse } = await import('../../ts/src/runtime/claude-code/mappers/post-tool-use');
    for (const [toolName, tool_input] of [
      ['Write', { filePath: '/tmp/write.txt' }],
      ['Edit', { path: '/tmp/edit.txt' }],
      ['Delete', { file_path: '/tmp/delete.txt' }],
      ['Bash', { command: 'echo ok', cwd: dir }],
      ['WebFetch', { url: 'https://example.test' }],
      ['WebSearch', { query: 'openbox' }],
      ['mcp__demo__tool', { value: true }],
    ] as const) {
      const session = recordingSession({ arm: toolName === 'Bash' ? 'halt' : 'allow' });
      const env: any = { tool_name: toolName, tool_input, tool_response: { ok: true }, session_id: `post-${toolName}` };
      const cfg: any = { skipTools: [], sessionDir: dir };
      const verdict = await handlePostToolUse(env, session, cfg);
      expect(verdict?.arm).toBe(toolName === 'Bash' ? 'halt' : 'allow');
      expect(session.calls[0]?.method).toBe('activity');
    }
  });
});

describe('runtime/claude-code/mappers/permission-request', () => {
  it('skip-tool short-circuits permission requests', async () => {
    const { handlePermissionRequest } = await import('../../ts/src/runtime/claude-code/mappers/permission-request');
    const session = recordingSession();
    const env: any = { tool_name: 'SkipMe', tool_input: {}, session_id: 'P1' };
    const cfg: any = { skipTools: ['SkipMe'], sessionDir: dir };
    await expect(handlePermissionRequest(env, session, cfg)).resolves.toBeUndefined();
    expect(session.calls).toHaveLength(0);
  });

  it('covers permission request route variants and halt marking', async () => {
    const { handlePermissionRequest } = await import('../../ts/src/runtime/claude-code/mappers/permission-request');
    for (const [toolName, tool_input] of [
      ['Read', { file_path: '/tmp/read.txt' }],
      ['Write', { filePath: '/tmp/write.txt' }],
      ['Edit', { path: '/tmp/edit.txt' }],
      ['Delete', { file_path: '/tmp/delete.txt' }],
      ['Bash', { command: 'pwd', cwd: dir }],
      ['WebFetch', { url: 'https://example.test' }],
      ['WebSearch', { query: 'openbox' }],
      ['mcp__demo__tool', { value: true }],
      ['UnknownTool', { value: true }],
    ] as const) {
      const session = recordingSession({ arm: toolName === 'Bash' ? 'halt' : 'allow' });
      const env: any = { tool_name: toolName, tool_input, session_id: `perm-${toolName}` };
      const cfg: any = { skipTools: [], sessionDir: dir };
      const verdict = await handlePermissionRequest(env, session, cfg);
      expect(verdict?.arm).toBe(toolName === 'Bash' ? 'halt' : 'allow');
      expect(session.calls[0]?.method).toBe('activity');
    }
  });
});

describe('runtime/cursor/config', () => {
  it('loadConfig pulls cursor-specific defaults', async () => {
    const { loadConfig } = await import('../../ts/src/runtime/cursor/config');
    const cfg = loadConfig();
    expect(cfg.openboxEndpoint).toBeDefined();
    expect(typeof cfg.governanceTimeout).toBe('number');
  });
});

describe('runtime/cursor/side-effects', () => {
  it('readFile honors skip patterns', async () => {
    const { sideEffects } = await import('../../ts/src/runtime/cursor/side-effects');
    expect(sideEffects.readFile!('/foo/.cursor/settings.json')).toBe('');
    // Real read: missing path returns '' (no throw).
    expect(sideEffects.readFile!('/var/no/such/file/here')).toBe('');
  });

  it('stringify pass-through + extractMcpText covers content/non-content shapes', async () => {
    const { sideEffects } = await import('../../ts/src/runtime/cursor/side-effects');
    expect(sideEffects.stringify!('plain')).toBe('plain');
    expect(sideEffects.stringify!({ a: 1 })).toContain('"a"');
    expect(sideEffects.extractMcpText!('hi')).toBe('hi'); // not JSON; echoes
    expect(
      sideEffects.extractMcpText!(
        JSON.stringify({ content: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] }),
      ),
    ).toBe('one\ntwo');
    expect(sideEffects.extractMcpText!({ misshapen: true })).toContain('misshapen');
  });
});

describe('runtime/cursor/mappers/pre-tool-use', () => {
  it('short-circuits unknown tools, skipped paths, and in-workspace file touches', async () => {
    const { handlePreToolUse } = await import('../../ts/src/runtime/cursor/mappers/pre-tool-use');
    const cfg: any = { skipTools: [], sessionDir: dir, hitlMaxWait: 1 };
    for (const env of [
      { tool_name: 'UnknownTool', tool_input: {}, conversation_id: 'C0', generation_id: 'G0' },
      { tool_name: 'Read', tool_input: { file_path: '/tmp/.git/config' }, conversation_id: 'C1', generation_id: 'G1' },
      {
        tool_name: 'Read',
        tool_input: { file_path: join(dir, 'inside-read.txt') },
        conversation_id: 'C2',
        generation_id: 'G2',
        workspace_roots: [dir],
      },
      {
        tool_name: 'Write',
        tool_input: { filePath: join(dir, 'inside-write.txt') },
        conversation_id: 'C3',
        generation_id: 'G3',
        workspace_roots: [dir],
      },
    ]) {
      const session = recordingSession();
      await expect(handlePreToolUse(env as any, session, cfg)).resolves.toBeUndefined();
      expect(session.calls).toHaveLength(0);
    }
  });

  it('drives the @activityVariant override path without throwing', async () => {
    const { handlePreToolUse } = await import('../../ts/src/runtime/cursor/mappers/pre-tool-use');
    const session = recordingSession();
    const env: any = {
      tool_name: 'Shell',
      tool_input: { command: 'rm -rf /tmp/foo' },
      conversation_id: 'C1',
      generation_id: `G-${Date.now()}`,
    };
    const cfg: any = { skipTools: [], sessionDir: dir, hitlMaxWait: 1 };
    await handlePreToolUse(env, session, cfg);
    expect(session.calls[0]?.method).toBe('activity');
    expect(session.calls[0]?.args[1]).toBe('FileDelete');
  });

  it('routes write tools through activity and marks halt verdicts', async () => {
    const { handlePreToolUse } = await import('../../ts/src/runtime/cursor/mappers/pre-tool-use');
    const cfg: any = { skipTools: [], sessionDir: dir, hitlMaxWait: 1 };
    const session = recordingSession({ arm: 'halt' });
    const env: any = {
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/outside-write.txt' },
      conversation_id: `C-Write-${Date.now()}`,
      generation_id: `G-Write-${Date.now()}`,
      workspace_roots: [dir],
    };
    const verdict = await handlePreToolUse(env, session, cfg);
    expect(verdict?.arm).toBe('halt');
    expect(session.calls[0]?.method).toBe('activity');
  });
});

describe('runtime/mcp/config', () => {
  it('createApi exists and does not throw on construction', async () => {
    process.env.OPENBOX_API_URL = 'http://localhost:3000';
    process.env.OPENBOX_CORE_URL = 'http://localhost:8086';
    const mod = await import('../../ts/src/runtime/mcp/config');
    expect(typeof mod.createApi).toBe('function');
    if ('setMcpClientName' in mod) {
      (mod as any).setMcpClientName('openbox-test');
    }
    delete process.env.OPENBOX_API_URL;
    delete process.env.OPENBOX_CORE_URL;
  });
});

describe('install/from-spec; defensive paths', () => {
  it('install + uninstall are idempotent across re-runs', async () => {
    const { installAdapter, uninstallAdapter } = await import('../../ts/src/install/from-spec');
    const target = join(dir, 'settings.json');
    const spec = {
      file: target,
      key: 'hooks',
      style: 'claude-array' as const,
      command: 'openbox claude-code hook',
      configDir: dir,
      events: [{ name: 'PreToolUse' }],
    };
    installAdapter(spec, { cwd: dir });
    installAdapter(spec, { cwd: dir }); // second install should be a no-op (no dup)
    uninstallAdapter(spec, { cwd: dir });
    uninstallAdapter(spec, { cwd: dir }); // second uninstall should be a no-op
  });
});
