// Coverage-driven tests for ts/src/runtime/claude-code/* and
// ts/src/runtime/cursor/*. Mappers take a real GovernSession in
// production; here we duck-type a recording session that captures
// every call so we can drive every branch (redaction, routing,
// halt-on-verdict, payload build) without a live backend.
//
// Real session-vs-core behavior is covered by e2e.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;
// Mock-only raw 32-byte Ed25519 key encoded at runtime; not a real credential.
const FAKE_AGENT_PRIVATE_KEY = Buffer.alloc(32, 1).toString('base64');
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
    async openActivity(...args: any[]) {
      calls.push({ method: 'openActivity', args });
      const activityId = args[1]?.activityId ?? `opened-${calls.length}`;
      return {
        activityId,
        verdict: { ...verdict, activityId },
        complete: async (...completeArgs: any[]) => {
          calls.push({ method: 'openActivity.complete', args: completeArgs });
          return verdict;
        },
      };
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
    process.env.OPENBOX_AGENT_DID = 'did:aip:550e8400-e29b-41d4-a716-446655440000';
    // gitleaks:allow - deterministic test fixture generated above, not a credential.
    process.env.OPENBOX_AGENT_PRIVATE_KEY = FAKE_AGENT_PRIVATE_KEY;
    // Force re-import so config picks up our env state at module-load time.
    const mod = await import('../../ts/src/runtime/claude-code/config');
    const cfg = mod.loadConfig();
    expect(cfg.openboxApiKey).toBe('obx_live_test_x');
    expect(cfg.openboxEndpoint).toBe('http://localhost:8086');
    expect(cfg.agentIdentity).toEqual({
      did: 'did:aip:550e8400-e29b-41d4-a716-446655440000',
      privateKey: FAKE_AGENT_PRIVATE_KEY,
    });
    delete process.env.OPENBOX_API_KEY;
    delete process.env.OPENBOX_CORE_URL;
    delete process.env.OPENBOX_AGENT_DID;
    delete process.env.OPENBOX_AGENT_PRIVATE_KEY;
  });

  it('loadConfig supplies sane defaults for unspecified fields', async () => {
    const mod = await import('../../ts/src/runtime/claude-code/config');
    const cfg = mod.loadConfig();
    expect(typeof cfg.governanceTimeout).toBe('number');
    expect(cfg.governancePolicy).toBe('fail_closed');
  });
});

describe('runtime/claude-code/side-effects', () => {
  it('readFile redacts metadata paths, reads real files, and tolerates missing', async () => {
    const { sideEffects } = await import('../../ts/src/runtime/claude-code/side-effects');
    expect(sideEffects.readFile!('/foo/.git/HEAD')).toBe('[OpenBox redacted file content]');
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
  it('old skip-tool config does not bypass governance', async () => {
    const { handlePreToolUse } = await import('../../ts/src/runtime/claude-code/mappers/pre-tool-use');
    const session = recordingSession();
    const env: any = { tool_name: 'TodoWrite', tool_input: { todos: [] }, session_id: 'S1' };
    const cfg: any = { skipTools: ['TodoWrite'], sessionDir: dir };
    const v = await handlePreToolUse(env, session, cfg);
    expect(v?.arm).toBe('allow');
    expect(session.calls[0]?.method).toBe('openActivity');
  });

  it('redaction-pattern paths still fire governance activity', async () => {
    const { handlePreToolUse } = await import('../../ts/src/runtime/claude-code/mappers/pre-tool-use');
    const session = recordingSession();
    const env: any = { tool_name: 'Read', tool_input: { file_path: '/foo/.git/config' }, session_id: 'S2' };
    const cfg: any = { sessionDir: dir };
    const v = await handlePreToolUse(env, session, cfg);
    expect(v?.arm).toBe('allow');
    expect(session.calls[0]?.method).toBe('openActivity');
    expect(session.calls[0]?.args[1]?.input?.[0]?.content).toBe('[OpenBox redacted file content]');
  });

  it('routes a known tool to openActivity() with the right activity_type', async () => {
    const { handlePreToolUse } = await import('../../ts/src/runtime/claude-code/mappers/pre-tool-use');
    const session = recordingSession();
    const env: any = { tool_name: 'Read', tool_input: { file_path: '/Users/me/main.ts' }, session_id: 'S3' };
    const cfg: any = { sessionDir: dir };
    await handlePreToolUse(env, session, cfg);
    expect(session.calls[0]?.method).toBe('openActivity');
  });

  it('mcp__* tools fall through to MCP_CALL', async () => {
    const { handlePreToolUse } = await import('../../ts/src/runtime/claude-code/mappers/pre-tool-use');
    const session = recordingSession();
    const env: any = { tool_name: 'mcp__filesystem__read', tool_input: {}, session_id: 'S4' };
    const cfg: any = { sessionDir: dir };
    await handlePreToolUse(env, session, cfg);
    expect(session.calls.length).toBeGreaterThan(0);
  });

  it('classifies database MCP tools as DatabaseQuery with database_query spans', async () => {
    const { handlePreToolUse } = await import('../../ts/src/runtime/claude-code/mappers/pre-tool-use');
    const session = recordingSession();
    const env: any = {
      tool_name: 'mcp__realdb__query_database',
      tool_input: {
        query: 'SELECT 1 AS openbox_real_db_probe',
        operation: 'QUERY',
        system: 'postgresql',
      },
      session_id: 'S4-db-mcp',
    };
    const cfg: any = { sessionDir: dir };
    await handlePreToolUse(env, session, cfg);
    expect(session.calls[0]?.args[0]).toBe('DatabaseQuery');
    const span = session.calls[0]?.args[1]?.spans?.[0] as Record<string, any>;
    expect(span?.semantic_type).toBe('database_query');
    expect(span?.db_operation).toBe('QUERY');
    expect(span?.db_statement).toBe('SELECT 1 AS openbox_real_db_probe');
  });

  it('builds HTTP spans from Claude tool input instead of hard-coding GET', async () => {
    const { handlePreToolUse } = await import('../../ts/src/runtime/claude-code/mappers/pre-tool-use');
    const session = recordingSession();
    const env: any = {
      tool_name: 'WebFetch',
      tool_input: {
        url: 'https://example.test/blocked',
        method: 'post',
      },
      session_id: 'S4-http',
    };
    const cfg: any = { sessionDir: dir };
    await handlePreToolUse(env, session, cfg);
    const span = session.calls[0]?.args[1]?.spans?.[0] as Record<string, any>;
    expect(span?.semantic_type).toBe('http_post');
    expect(span?.http_method).toBe('POST');
    expect(span?.http_url).toBe('https://example.test/blocked');
  });

  it('halt verdict triggers markHalted (no throw)', async () => {
    const { handlePreToolUse } = await import('../../ts/src/runtime/claude-code/mappers/pre-tool-use');
    const session = recordingSession({ arm: 'halt' });
    const env: any = { tool_name: 'Read', tool_input: { file_path: '/Users/me/x.ts' }, session_id: 'halt-session' };
    const cfg: any = { sessionDir: dir };
    const v = await handlePreToolUse(env, session, cfg);
    expect(v?.arm).toBe('halt');
  });
});

describe('runtime/claude-code/mappers/post-tool-use', () => {
  it('fires COMPLETE activity for known tools', async () => {
    const { handlePostToolUse } = await import('../../ts/src/runtime/claude-code/mappers/post-tool-use');
    const session = recordingSession();
    const env: any = { tool_name: 'Read', tool_input: { file_path: '/Users/me/main.ts' }, tool_response: 'ok', session_id: 'S5' };
    const cfg: any = { sessionDir: dir };
    await handlePostToolUse(env, session, cfg);
    expect(session.calls[0]?.method).toBe('activity');
    expect(session.calls[0]?.args[2].output).toBe('ok');
  });

  it('old skip-tool config does not bypass post-tool completion', async () => {
    const { handlePostToolUse } = await import('../../ts/src/runtime/claude-code/mappers/post-tool-use');
    const session = recordingSession();
    const env: any = {
      tool_name: 'Read',
      tool_input: { file_path: '/Users/me/main.ts' },
      tool_response: 'ok',
      session_id: 'S5-skip',
    };
    const cfg: any = { skipTools: ['Read'], sessionDir: dir };
    await expect(handlePostToolUse(env, session, cfg)).resolves.toMatchObject({ arm: 'allow' });
    expect(session.calls).toHaveLength(1);
    expect(session.calls[0]?.method).toBe('activity');
  });

  it('routes unknown post-tool events through the generic agent action fallback', async () => {
    const { handlePostToolUse } = await import('../../ts/src/runtime/claude-code/mappers/post-tool-use');
    const session = recordingSession();
    const env: any = { tool_name: 'UnknownTool', tool_input: {}, tool_response: 'ok', session_id: 'S5b' };
    const cfg: any = { sessionDir: dir };
    await expect(handlePostToolUse(env, session, cfg)).resolves.toMatchObject({ arm: 'allow' });
    expect(session.calls).toHaveLength(1);
    expect(session.calls[0]?.args[1]).toBe('AgentAction');
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
      const cfg: any = { sessionDir: dir };
      const verdict = await handlePostToolUse(env, session, cfg);
      expect(verdict?.arm).toBe(toolName === 'Bash' ? 'halt' : 'allow');
      expect(session.calls[0]?.method).toBe('activity');
    }
  });

  it('preserves HTTP method and target in post-tool spans', async () => {
    const { handlePostToolUse } = await import('../../ts/src/runtime/claude-code/mappers/post-tool-use');
    const session = recordingSession();
    const env: any = {
      tool_name: 'WebFetch',
      tool_input: {
        url: 'https://example.test/complete',
        http_method: 'patch',
      },
      tool_response: { ok: true },
      session_id: 'post-http',
    };
    const cfg: any = { sessionDir: dir };
    await handlePostToolUse(env, session, cfg);
    const span = session.calls[0]?.args[2]?.spans?.[0] as Record<string, any>;
    expect(span?.semantic_type).toBe('http_patch');
    expect(span?.http_method).toBe('PATCH');
    expect(span?.http_url).toBe('https://example.test/complete');
  });

  it('emits spans for failed tool completions', async () => {
    const { handlePostToolUseFailure } = await import('../../ts/src/runtime/claude-code/mappers/post-tool-use');
    const session = recordingSession();
    const env: any = {
      tool_name: 'Bash',
      tool_input: { command: 'npm test', cwd: dir },
      error: 'exit 1',
      session_id: 'post-failure-shell',
    };
    const cfg: any = { sessionDir: dir };
    await handlePostToolUseFailure(env, session, cfg);
    const payload = session.calls[0]?.args[2];
    const span = payload?.spans?.[0] as Record<string, any>;
    expect(payload.toolName).toBe('Bash');
    expect(payload.toolType).toBe('shell');
    expect(span).toMatchObject({
      name: 'ShellExecution',
      semantic_type: 'internal',
      attributes: expect.objectContaining({
        'shell.command': 'npm test',
        'openbox.tool.name': 'Bash',
      }),
    });
  });
});

describe('runtime/claude-code/mappers/permission-request', () => {
  it('old skip-tool config does not bypass permission requests', async () => {
    const { handlePermissionRequest } = await import('../../ts/src/runtime/claude-code/mappers/permission-request');
    const session = recordingSession();
    const env: any = { tool_name: 'TodoWrite', tool_input: { todos: [] }, session_id: 'P1' };
    const cfg: any = { skipTools: ['TodoWrite'], sessionDir: dir };
    await expect(handlePermissionRequest(env, session, cfg)).resolves.toMatchObject({ arm: 'allow' });
    expect(session.calls).toHaveLength(1);
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
      const cfg: any = { sessionDir: dir };
      const verdict = await handlePermissionRequest(env, session, cfg);
      expect(verdict?.arm).toBe(toolName === 'Bash' ? 'halt' : 'allow');
      expect(session.calls[0]?.method).toBe('activity');
    }
  });

  it('preserves HTTP method and target in permission-request spans', async () => {
    const { handlePermissionRequest } = await import('../../ts/src/runtime/claude-code/mappers/permission-request');
    const session = recordingSession();
    const env: any = {
      tool_name: 'WebFetch',
      tool_input: {
        href: 'https://example.test/permission',
        httpMethod: 'delete',
      },
      session_id: 'perm-http',
    };
    const cfg: any = { sessionDir: dir };
    await handlePermissionRequest(env, session, cfg);
    const span = session.calls[0]?.args[2]?.spans?.[0] as Record<string, any>;
    expect(span?.semantic_type).toBe('http_delete');
    expect(span?.http_method).toBe('DELETE');
    expect(span?.http_url).toBe('https://example.test/permission');
  });

  it('emits spans for permission-denied tool telemetry', async () => {
    const { handlePermissionDenied } = await import('../../ts/src/runtime/claude-code/mappers/permission-request');
    const session = recordingSession();
    const env: any = {
      tool_name: 'Bash',
      tool_input: { command: 'npm test', cwd: dir },
      reason: 'auto mode denied',
      session_id: 'permission-denied-shell',
    };
    const cfg: any = { sessionDir: dir };
    await handlePermissionDenied(env, session, cfg);
    const payload = session.calls[0]?.args[2];
    const span = payload?.spans?.[0] as Record<string, any>;
    expect(payload.sessionId).toBe('permission-denied-shell');
    expect(payload.toolName).toBe('Bash');
    expect(payload.toolType).toBe('shell');
    expect(span).toMatchObject({
      name: 'ShellExecution',
      semantic_type: 'internal',
      attributes: expect.objectContaining({
        'shell.command': 'npm test',
        'openbox.tool.name': 'Bash',
      }),
    });
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
  it('readFile redacts metadata paths', async () => {
    const { sideEffects } = await import('../../ts/src/runtime/cursor/side-effects');
    expect(sideEffects.readFile!('/foo/.cursor/settings.json')).toBe('[OpenBox redacted file content]');
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
  it('short-circuits unknown tools and routine in-workspace file touches', async () => {
    const { handlePreToolUse } = await import('../../ts/src/runtime/cursor/mappers/pre-tool-use');
    const cfg: any = { sessionDir: dir, hitlMaxWait: 1 };
    for (const env of [
      { tool_name: 'UnknownTool', tool_input: {}, conversation_id: 'C0', generation_id: 'G0' },
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

  it('governs metadata paths instead of treating them as routine workspace reads', async () => {
    const { handlePreToolUse } = await import('../../ts/src/runtime/cursor/mappers/pre-tool-use');
    const cfg: any = { sessionDir: dir, hitlMaxWait: 1 };
    const session = recordingSession();
    const verdict = await handlePreToolUse(
      {
        tool_name: 'Read',
        tool_input: { file_path: join(dir, '.git', 'config') },
        conversation_id: 'C-redacted',
        generation_id: 'G-redacted',
        workspace_roots: [dir],
      } as any,
      session,
      cfg,
    );
    expect(verdict?.arm).toBe('allow');
    expect(session.calls[0]?.method).toBe('openActivity');
    expect(session.calls[0]?.args[1]?.input?.[0]?.content).toBe('[OpenBox redacted file content]');
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
    const cfg: any = { sessionDir: dir, hitlMaxWait: 1 };
    await handlePreToolUse(env, session, cfg);
    expect(session.calls[0]?.method).toBe('openActivity');
    expect(session.calls[0]?.args[0]).toBe('FileDelete');
  });

  it('routes write tools through activity and marks halt verdicts', async () => {
    const { handlePreToolUse } = await import('../../ts/src/runtime/cursor/mappers/pre-tool-use');
    const cfg: any = { sessionDir: dir, hitlMaxWait: 1 };
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
    expect(session.calls[0]?.method).toBe('openActivity');
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
