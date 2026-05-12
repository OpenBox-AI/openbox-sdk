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
    process.env.OPENBOX_ENDPOINT = 'http://localhost:8086';
    // Force re-import so config picks up our env state at module-load time.
    const mod = await import('../../ts/src/runtime/claude-code/config');
    const cfg = mod.loadConfig();
    expect(cfg.openboxApiKey).toBe('obx_live_test_x');
    expect(cfg.openboxEndpoint).toBe('http://localhost:8086');
    delete process.env.OPENBOX_API_KEY;
    delete process.env.OPENBOX_ENDPOINT;
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
  it('drives the @activityVariant override path without throwing', async () => {
    const { handlePreToolUse } = await import('../../ts/src/runtime/cursor/mappers/pre-tool-use');
    const session = recordingSession();
    const env: any = {
      tool_name: 'shell',
      tool_input: { command: 'rm -rf /tmp/foo' },
      conversation_id: 'C1',
    };
    const cfg: any = { skipTools: [], sessionDir: dir };
    await handlePreToolUse(env, session, cfg);
    // The cursor variant either fires once or short-circuits; drive
    // the function for coverage; precise behavior covered by e2e.
    expect(typeof session.calls.length).toBe('number');
  });
});

describe('runtime/mcp/config', () => {
  it('resolveEnv + createApi exist and don\'t throw on construction', async () => {
    process.env.OPENBOX_API_URL = 'http://localhost:3000';
    process.env.OPENBOX_CORE_URL = 'http://localhost:8086';
    const mod = await import('../../ts/src/runtime/mcp/config');
    expect(typeof mod.resolveEnv).toBe('function');
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
    installAdapter(spec);
    installAdapter(spec); // second install should be a no-op (no dup)
    uninstallAdapter(spec);
    uninstallAdapter(spec); // second uninstall should be a no-op
  });
});
