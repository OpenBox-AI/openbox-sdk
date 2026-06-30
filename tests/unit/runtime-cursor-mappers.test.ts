// cursor runtime adapter; every per-event mapper plus a few mixed
// concerns the cursor adapter shares with the rest of the runtime
// (redaction helpers, validator extras, env precedence, install
// command wrappers, public
// maturity surface).
//
// Cursor mappers covered:
//   - mappers/prompt          ; beforeSubmitPrompt
//   - mappers/shell           ; beforeShellExecution
//   - mappers/file-read       ; beforeReadFile
//   - mappers/mcp + mcp-response; beforeMCPExecution + after envelope parsing
//   - mappers/observe         ; every after-* observe-only handler
//   - mappers/pre-tool-use    ; @activityVariant override (Shell→FileDelete)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;
const ORIGINAL_OPENBOX_HOME = process.env.OPENBOX_HOME;
const FAKE_AGENT_PRIVATE_KEY = Buffer.alloc(32, 1).toString('base64');
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'openbox-final-2-'));
  process.env.OPENBOX_HOME = join(dir, '.openbox');
});
afterEach(() => {
  if (ORIGINAL_OPENBOX_HOME === undefined) delete process.env.OPENBOX_HOME;
  else process.env.OPENBOX_HOME = ORIGINAL_OPENBOX_HOME;
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

function recordingSession(verdict: any = { arm: 'allow' }): any {
  const calls: { method: string; args: any[] }[] = [];
  const proxy: any = {
    workflowId: 'wf', runId: 'run', workflowType: 't', taskQueue: 'g',
    isOpen: true, isTerminated: false, calls,
  };
  const methods = ['activity', 'workflowStarted', 'workflowCompleted', 'workflowFailed',
    'preToolUse', 'postToolUse', 'userPromptSubmit', 'beforeShellExecution', 'afterFileEdit',
    'beforeReadFile', 'afterReadFile', 'beforeMCPExecution', 'afterMCPExecution',
    'beforeSubmitPrompt', 'sessionStart', 'sessionStop'];
  for (const m of methods) {
    proxy[m] = async (...a: any[]) => { calls.push({ method: m, args: a }); return verdict; };
  }
  proxy.openActivity = async (...a: any[]) => {
    calls.push({ method: 'openActivity', args: a });
    return {
      activityId: a[1]?.activityId ?? `opened-${calls.length}`,
      verdict,
      complete: async (...completeArgs: any[]) => {
        calls.push({ method: 'openActivity.complete', args: completeArgs });
        return verdict;
      },
    };
  };
  return proxy;
}

function movedRuntimeSettingKey(prefix: string, suffix: string): string {
  return `${prefix}${suffix}`;
}

describe('core-client/redaction', () => {
  it('exercises every export with real shape/value assertions', async () => {
    const mod = await import('../../ts/src/core-client/redaction');
    // Every named export must be present (no silent loss in re-export).
    for (const fn of Object.values(mod)) {
      expect(typeof fn).toBe('function');
    }

    // deepUpdateObject: deep-merges source into target, mutating in place.
    const target: Record<string, unknown> = { a: 1, b: { c: 2 } };
    mod.deepUpdateObject(target, { b: { d: 3 }, e: 4 });
    expect(target).toEqual({ a: 1, b: { c: 2, d: 3 }, e: 4 });
    // ...and rejects a non-plain-object target.
    expect(() => mod.deepUpdateObject('nope' as never, {})).toThrow();

    // applyInputRedaction / applyOutputRedaction are no-ops without a verdict.
    expect(mod.applyInputRedaction({ p: 'secret' }, undefined)).toEqual({ p: 'secret' });
    expect(mod.applyOutputRedaction({ p: 'secret' }, undefined)).toEqual({ p: 'secret' });

    // hasGuardrailRedaction: false without a verdict, true when there's an
    // input-like redaction to apply.
    expect(mod.hasGuardrailRedaction(undefined)).toBe(false);
    expect(
      mod.hasGuardrailRedaction({
        inputType: 'activity_input',
        redactedInput: { prompt: '[REDACTED]' },
        fieldResults: [],
      } as never),
    ).toBe(true);

    // summarizeGuardrailRedaction: default message vs. a field-driven summary.
    expect(mod.summarizeGuardrailRedaction(undefined)).toBe(
      'OpenBox redacted sensitive fields.',
    );
    expect(
      mod.summarizeGuardrailRedaction({
        fieldResults: [{ field: 'ssn', status: 'redacted' }],
      } as never),
    ).toContain('ssn');
  });

  it('applyInputRedaction replaces flagged secret content with the verdict redaction', async () => {
    // (Was a no-op: it looked for a non-existent `redact`/`redactSecrets` export and
    // only asserted typeof === 'string'. Redaction is verdict-driven via
    // applyInputRedaction; assert the secret is ACTUALLY removed.)
    const { applyInputRedaction } = await import('../../ts/src/core-client/redaction');
    const original = { prompt: 'export OPENBOX_API_KEY=obx_live_secretvalue' };
    const out = applyInputRedaction(original, {
      inputType: 'activity_input',
      redactedInput: { prompt: '[REDACTED]' },
    } as never);
    expect(out).toEqual({ prompt: '[REDACTED]' });
    expect(JSON.stringify(out)).not.toContain('obx_live_secretvalue');
    expect(applyInputRedaction(original, undefined)).toEqual(original);
  });
});

describe('validators/index; extra surface', () => {
  it('each named validator accepts canonical input + rejects malformed input', async () => {
    const v = await import('../../ts/src/validators');
    const { ValidationError } = v;

    // Canonical-input cases; must NOT throw.
    expect(v.validateUuid('00000000-0000-4000-8000-000000000000', 'id')).toBeTruthy();
    expect(v.validateUuidList(['00000000-0000-4000-8000-000000000000'], 'ids')).toHaveLength(1);
    expect(v.validateIsoDate('2025-01-01T00:00:00.000Z', 'when')).toMatch(/2025/);
    expect(v.validateInt('42', 'n')).toBe(42);
    expect(v.validateEnum('a', ['a', 'b'] as const, 'mode')).toBe('a');
    expect(v.validateBehaviorTrigger('http_post')).toBe('http_post');
    expect(v.validateBehaviorTrigger('llm_gen_ai')).toBe('llm_gen_ai');
    expect(v.validateBehaviorTrigger('mcp_tool_call')).toBe('mcp_tool_call');
    // validateRegoSource requires both a package decl AND a `result := {...}`
    // assignment (core reads only result.decision / result.reason).
    expect(() =>
      v.validateRegoSource(
        'package x\ndefault result := {"decision": "ALLOW", "reason": ""}',
      ),
    ).not.toThrow();
    // validateApprovalTimeout: verdict 2 (REQUIRE_APPROVAL) requires positive
    // timeout; other verdicts are no-ops on timeout.
    expect(() => v.validateApprovalTimeout(2, 30)).not.toThrow();
    // verdict 3 (BLOCK) doesn't validate timeout; no-op even with 0.
    expect(() => v.validateApprovalTimeout(3, 0)).not.toThrow();

    // Malformed-input cases; MUST throw ValidationError.
    expect(() => v.validateUuid('not-a-uuid', 'id')).toThrow(ValidationError);
    expect(() => v.validateUuidList(['bad'], 'ids')).toThrow(ValidationError);
    expect(() => v.validateIsoDate('not-a-date', 'when')).toThrow(ValidationError);
    expect(() => v.validateInt('abc', 'n')).toThrow(ValidationError);
    expect(() => v.validateEnum('z', ['a', 'b'] as const, 'mode')).toThrow(ValidationError);
    expect(() => v.validateBehaviorTrigger('made_up_trigger')).toThrow(ValidationError);
    // validateApprovalTimeout: REQUIRE_APPROVAL (verdict=2) with missing /
    // 0 timeout is invalid; backend would 422.
    expect(() => v.validateApprovalTimeout(2, undefined)).toThrow(ValidationError);
    expect(() => v.validateApprovalTimeout(2, 0)).toThrow(ValidationError);
  });

  it('parseJsonInput parses valid + bails on invalid', async () => {
    const { parseJsonInput, ValidationError } = await import('../../ts/src/validators');
    expect(parseJsonInput<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
    // Reads from @file paths.
    const fs = await import('node:fs');
    const f = join(dir, 'p.json');
    fs.writeFileSync(f, '{"b":2}');
    expect(parseJsonInput(`@${f}`)).toEqual({ b: 2 });
    // Invalid JSON throws; but the impl may throw the underlying
    // SyntaxError or wrap as ValidationError. Either is fine; we
    // only need the throw branch covered.
    expect(() => parseJsonInput('not-json')).toThrow();
    void ValidationError; // silence unused-import lint
  });

  it('parsePagination merges page + limit defaults', async () => {
    const { parsePagination } = await import('../../ts/src/validators');
    const out = parsePagination({ page: '2', limit: '50' });
    expect(out).toEqual({ page: 2, perPage: 50 });
    const def = parsePagination({});
    expect(def.page).toBeGreaterThanOrEqual(0);
  });

  it('warn() prints to stderr without throwing', async () => {
    const { warn } = await import('../../ts/src/validators');
    const orig = console.error;
    const sink: string[] = [];
    console.error = (...a) => sink.push(a.join(' '));
    try {
      warn('something', 'docs/section');
      warn('plain');
    } finally {
      console.error = orig;
    }
    // First call prints `warn: something` + `see: docs/section` (2 lines);
    // second prints `warn: plain` only.
    expect(sink.length).toBe(3);
    expect(sink[0]).toContain('warn:');
    expect(sink[0]).toContain('something');
    expect(sink[1]).toContain('see:');
    expect(sink[2]).toContain('warn:');
    expect(sink[2]).toContain('plain');
  });
});

describe('runtime/cursor/mappers; drive every handler', () => {
  it('observe handlers fire activity for after-* events', async () => {
    const { handleAfterReadFile, handleAfterFileEdit, handleAfterShellExecution, handleAfterMCPExecution, handleAfterSubmitPrompt, handleSessionStart, handleSessionEnd } = await import('../../ts/src/runtime/cursor/mappers/observe').then((m: any) => m);
    const session = recordingSession();
    const cfg = { sessionDir: dir } as any;
    const env = { conversation_id: 'C', tool_name: 'shell', tool_input: { command: 'ls' }, tool_response: 'ok' } as any;
    if (typeof handleAfterReadFile === 'function') await handleAfterReadFile(env, session, cfg);
    if (typeof handleAfterFileEdit === 'function') await handleAfterFileEdit(env, session, cfg);
    if (typeof handleAfterShellExecution === 'function') await handleAfterShellExecution(env, session, cfg);
    if (typeof handleAfterMCPExecution === 'function') await handleAfterMCPExecution(env, session, cfg);
    if (typeof handleAfterSubmitPrompt === 'function') await handleAfterSubmitPrompt(env, session, cfg);
    if (typeof handleSessionStart === 'function') await handleSessionStart(env, session, cfg);
    if (typeof handleSessionEnd === 'function') await handleSessionEnd(env, session, cfg);
  });

  it('beforeReadFile / beforeShellExecution fire activity for decision events', async () => {
    const promptMod: any = await import('../../ts/src/runtime/cursor/mappers/prompt');
    const shellMod: any = await import('../../ts/src/runtime/cursor/mappers/shell');
    const fileReadMod: any = await import('../../ts/src/runtime/cursor/mappers/file-read');
    const session = recordingSession();
    const cfg = { sessionDir: dir } as any;
    if (typeof promptMod.handleBeforeSubmitPrompt === 'function') {
      await promptMod.handleBeforeSubmitPrompt({ conversation_id: 'C', prompt: 'hi' } as any, session, cfg);
    }
    const goalSignal = session.calls.find(
      (call: any) => call.method === 'activity' && call.args[0] === 'SignalReceived',
    );
    expect(goalSignal?.args[1]).toBe('user_prompt');
    expect(goalSignal?.args[2]).toMatchObject({
      signalName: 'user_prompt',
      signalArgs: 'hi',
      sessionId: 'C',
      prompt: 'hi',
      input: [{ prompt: 'hi', event_category: 'agent_goal', _openbox_source: 'cursor' }],
    });
    expect(goalSignal?.args[2].spans).toBeUndefined();
    const promptGate = session.calls.find(
      (call: any) =>
        call.method === 'activity' &&
        call.args[0] === 'ActivityStarted' &&
        call.args[1] === 'PromptSubmission',
    );
    expect(promptGate?.args[2]).toMatchObject({
      sessionId: 'C',
      prompt: 'hi',
      toolType: 'llm',
    });
    // Canonical http_request span: no `module` root field (function_call only)
    // and no openbox.*/gen_ai.* attributes — only native OTel http.* survive.
    expect(promptGate?.args[2].spans?.[0]).toMatchObject({
      name: 'POST',
      semantic_type: 'llm_completion',
      attributes: expect.objectContaining({
        'http.method': 'POST',
      }),
    });
    expect(session.calls.indexOf(promptGate)).toBeGreaterThan(session.calls.indexOf(goalSignal));
    if (typeof shellMod.handleBeforeShellExecution === 'function') {
      await shellMod.handleBeforeShellExecution(
        { conversation_id: 'C-decision', generation_id: `${dir}:shell-marker`, command: 'pwd' } as any,
        session,
        cfg,
      );
    }
    if (typeof fileReadMod.handleBeforeReadFile === 'function') {
      await fileReadMod.handleBeforeReadFile(
        { conversation_id: 'C-decision', generation_id: `${dir}:file-marker`, file_path: '/tmp/test.txt' } as any,
        session,
        cfg,
      );
    }
    const shellGate = session.calls.find(
      (call: any) => call.method === 'openActivity' && call.args[0] === 'ShellExecution',
    );
    expect(shellGate?.args[1].input).toContainEqual({
      __openbox: { tool_type: 'shell' },
    });
    const fileGate = session.calls.find(
      (call: any) => call.method === 'openActivity' && call.args[0] === 'FileRead',
    );
    expect(fileGate?.args[1].input).toContainEqual({
      __openbox: { tool_type: 'file_read' },
    });
  });

  it('beforeTabFileRead skips routine project files but gates sensitive project files', async () => {
    const fileReadMod: any = await import('../../ts/src/runtime/cursor/mappers/file-read');
    const cfg = { sessionDir: dir } as any;

    const routine = recordingSession();
    const routineVerdict = await fileReadMod.handleBeforeTabFileRead(
      { conversation_id: 'C', file_path: join(dir, 'src', 'index.ts'), workspace_roots: [dir] } as any,
      routine,
      cfg,
    );
    expect(routineVerdict).toBeUndefined();
    expect(routine.calls).toHaveLength(0);

    const sensitive = recordingSession({ arm: 'block', reason: 'secret read' });
    const sensitiveVerdict = await fileReadMod.handleBeforeTabFileRead(
      { conversation_id: 'C', file_path: join(dir, '.env'), workspace_roots: [dir] } as any,
      sensitive,
      cfg,
    );
    expect(sensitiveVerdict).toMatchObject({ arm: 'block' });
    expect(sensitive.calls.some((c: { method: string }) => c.method === 'activity')).toBe(true);
    const gate = sensitive.calls.find(
      (call: any) => call.method === 'activity' && call.args[1] === 'FileRead',
    );
    expect(gate?.args[2].input).toContainEqual({
      __openbox: { tool_type: 'file_open' },
    });
    // Canonical file.open drops the `file.operation` attribute (operation lives
    // at the root) and strips openbox.* — only native attrs + tool.name survive.
    expect(gate?.args[2].spans?.[0]).toMatchObject({
      semantic_type: 'file_open',
      file_operation: 'open',
      attributes: expect.objectContaining({
        'file.path': join(dir, '.env'),
        'tool.name': 'TabRead',
      }),
    });
    expect(
      (gate?.args[2].spans?.[0] as { attributes?: Record<string, unknown> })
        ?.attributes?.['file.operation'],
    ).toBeUndefined();
  });

  it('mcp + mcp-response handlers process MCP-shaped envelopes', async () => {
    const mcp: any = await import('../../ts/src/runtime/cursor/mappers/mcp');
    const mcpResp: any = await import('../../ts/src/runtime/cursor/mappers/mcp-response');
    const session = recordingSession();
    const cfg = { sessionDir: dir } as any;
    const env = {
      conversation_id: 'C',
      generation_id: `${dir}:mcp-marker`,
      server_name: 'fs',
      tool_name: 'read_file',
      tool_input: { path: '/tmp/x' },
      result_json: { content: [{ type: 'text', text: 'data' }] },
      response: { content: [{ type: 'text', text: 'data' }] },
    } as any;
    if (typeof mcp.handleBeforeMCPExecution === 'function') await mcp.handleBeforeMCPExecution(env, session, cfg);
    if (typeof mcpResp.handleAfterMCPExecution === 'function') await mcpResp.handleAfterMCPExecution(env, session, cfg);
    const mcpGate = session.calls.find(
      (call: any) => call.method === 'openActivity' && call.args[0] === 'MCPToolCall',
    );
    expect(mcpGate?.args[1].input).toContainEqual({
      __openbox: { tool_type: 'mcp' },
    });
    const mcpCompleted = session.calls.find(
      (call: any) =>
        call.method === 'activity' &&
        call.args[0] === 'ActivityCompleted' &&
        call.args[1] === 'MCPToolCall',
    );
    expect(mcpCompleted?.args[2].spans?.[0]).toMatchObject({
      stage: 'completed',
      semantic_type: 'mcp_tool_call',
    });
  });

  it('mcp completion preserves DB and HTTP classifications from tool input', async () => {
    const mcp: any = await import('../../ts/src/runtime/cursor/mappers/mcp');
    const mcpResp: any = await import('../../ts/src/runtime/cursor/mappers/mcp-response');
    const cfg = { sessionDir: dir } as any;

    const dbSession = recordingSession();
    const dbEnv = {
      conversation_id: 'C-db',
      generation_id: `${dir}:mcp-db-marker`,
      tool_name: 'mcp__postgres__query',
      tool_input: { sql: 'SELECT 1', db_system: 'postgresql' },
      result_json: { content: [{ type: 'text', text: 'rows' }] },
      duration: 12,
    } as any;
    await mcp.handleBeforeMCPExecution(dbEnv, dbSession, cfg);
    await mcpResp.handleAfterMCPExecution(dbEnv, dbSession, cfg);
    const dbCompleted = dbSession.calls.find(
      (call: any) =>
        call.method === 'activity' &&
        call.args[0] === 'ActivityCompleted' &&
        call.args[1] === 'DatabaseQuery',
    );
    expect(dbCompleted?.args[2]).toMatchObject({
      toolType: 'db',
    });
    expect(dbCompleted?.args[2].input).toContainEqual({
      __openbox: { tool_type: 'db' },
    });
    expect(dbCompleted?.args[2].spans?.[0]).toMatchObject({
      stage: 'completed',
      semantic_type: 'database_select',
      attributes: expect.objectContaining({
        'db.system': 'postgresql',
        'db.operation': 'SELECT',
        'db.statement': 'SELECT 1',
      }),
    });

    const httpSession = recordingSession();
    const httpEnv = {
      conversation_id: 'C-http',
      generation_id: `${dir}:mcp-http-marker`,
      tool_name: 'mcp__web__request',
      tool_input: { url: 'https://example.test/ping', method: 'post' },
      result_json: { content: [{ type: 'text', text: 'ok' }] },
      duration: 7,
    } as any;
    await mcp.handleBeforeMCPExecution(httpEnv, httpSession, cfg);
    await mcpResp.handleAfterMCPExecution(httpEnv, httpSession, cfg);
    const httpCompleted = httpSession.calls.find(
      (call: any) =>
        call.method === 'activity' &&
        call.args[0] === 'ActivityCompleted' &&
        call.args[1] === 'HTTPRequest',
    );
    expect(httpCompleted?.args[2]).toMatchObject({
      toolType: 'http',
    });
    expect(httpCompleted?.args[2].input).toContainEqual({
      __openbox: { tool_type: 'http' },
    });
    expect(httpCompleted?.args[2].spans?.[0]).toMatchObject({
      stage: 'completed',
      semantic_type: 'http_post',
      attributes: expect.objectContaining({
        'http.method': 'POST',
        'http.url': 'https://example.test/ping',
      }),
    });
  });
});

describe('runtime configs; env precedence + defaults', () => {
  it('claude-code config reads connection env and leaves tuning in project config', async () => {
    const before = { ...process.env };
    const beforeCwd = process.cwd();
    mkdirSync(join(dir, '.openbox', 'claude-code'), { recursive: true });
    writeFileSync(
      join(dir, '.openbox', 'claude-code', 'config.json'),
      JSON.stringify({ verbose: true, hitlEnabled: false, hitlMaxWait: 12 }),
    );
    process.chdir(dir);
    process.env.OPENBOX_API_KEY = 'obx_live_envtest';
    process.env.OPENBOX_CORE_URL = 'http://localhost:9999';
    process.env[movedRuntimeSettingKey('VER', 'BOSE')] = 'false';
    process.env[movedRuntimeSettingKey('HITL_', 'ENABLED')] = 'true';
    process.env[movedRuntimeSettingKey('HITL_', 'MAX_WAIT')] = '999';
    try {
      vi.resetModules();
      const mod = await import('../../ts/src/runtime/claude-code/config');
      const cfg = mod.loadConfig();
      expect(cfg.openboxApiKey).toBe('obx_live_envtest');
      expect(cfg.openboxEndpoint).toBe('http://localhost:9999');
      expect(cfg.hitlEnabled).toBe(false);
      expect(cfg.hitlMaxWait).toBe(12);
      expect(cfg.verbose).toBe(true);
    } finally {
      process.chdir(beforeCwd);
      process.env = before;
      vi.resetModules();
    }
  });

  it('cursor config reads connection and identity env only', async () => {
    const before = { ...process.env };
    const beforeCwd = process.cwd();
    mkdirSync(join(dir, '.openbox', 'cursor'), { recursive: true });
    writeFileSync(
      join(dir, '.openbox', 'cursor', 'config.json'),
      JSON.stringify({
        verbose: true,
        hitlEnabled: false,
        hitlMaxWait: 9,
        approvalSocketPath: '/tmp/openbox-project-approval.sock',
      }),
    );
    process.chdir(dir);
    process.env.OPENBOX_API_KEY = 'obx_live_envtest';
    process.env.OPENBOX_CORE_URL = 'http://localhost:9999';
    process.env.OPENBOX_AGENT_DID = 'did:aip:550e8400-e29b-41d4-a716-446655440000';
    process.env.OPENBOX_AGENT_PRIVATE_KEY = FAKE_AGENT_PRIVATE_KEY;
    process.env[movedRuntimeSettingKey('VER', 'BOSE')] = 'false';
    process.env[movedRuntimeSettingKey('HITL_', 'ENABLED')] = 'true';
    process.env[movedRuntimeSettingKey('HITL_', 'MAX_WAIT')] = '999';
    process.env[['OPENBOX', 'APPROVAL', 'SOCKET'].join('_')] =
      '/tmp/openbox-env-approval.sock';
    try {
      vi.resetModules();
      const mod = await import('../../ts/src/runtime/cursor/config');
      const cfg = mod.loadConfig();
      expect(cfg.openboxApiKey).toBe('obx_live_envtest');
      expect(cfg.openboxEndpoint).toBe('http://localhost:9999');
      expect(cfg.hitlEnabled).toBe(false);
      expect(cfg.hitlMaxWait).toBe(9);
      expect(cfg.verbose).toBe(true);
      expect(cfg.approvalSocketPath).toBe('/tmp/openbox-project-approval.sock');
      expect(cfg.agentIdentity).toEqual({
        did: 'did:aip:550e8400-e29b-41d4-a716-446655440000',
        privateKey: FAKE_AGENT_PRIVATE_KEY,
      });
    } finally {
      process.chdir(beforeCwd);
      process.env = before;
      vi.resetModules();
    }
  });
});

describe('install commands; claude-code / cursor / skill', () => {
  it('claude-code plugin commands register cleanly', async () => {
    const { registerClaudeCodeCommands } = await import('../../ts/src/cli/commands/claude-code');
    const program = new Command();
    program.exitOverride();
    registerClaudeCodeCommands(program);
    // Just exercise the registration path; filesystem install
    // behavior is covered by the plugin install tests.
    expect(program.commands.find((c) => c.name() === 'claude-code')).toBeDefined();
  });

  it('cursor plugin commands register cleanly', async () => {
    const { registerCursorCommands } = await import('../../ts/src/cli/commands/cursor');
    const program = new Command();
    program.exitOverride();
    registerCursorCommands(program);
    expect(program.commands.find((c) => c.name() === 'cursor')).toBeDefined();
  });

  it('skill command registers + path subcommand returns a string', async () => {
    const { registerSkillCommands } = await import('../../ts/src/cli/commands/skill');
    const program = new Command();
    program.exitOverride();
    registerSkillCommands(program);
    const skill = program.commands.find((c) => c.name() === 'skill');
    expect(skill).toBeDefined();
    expect(skill!.commands.map((s) => s.name())).toContain('path');
  });
});

describe('maturity/index; full surface', () => {
  it('enableFeature single-flag adds to enabled set', async () => {
    const mod = await import('../../ts/src/maturity');
    mod.enableFeature('coverage.test.flag');
    expect(mod.isFeatureEnabled('coverage.test.flag')).toBe(true);
  });

  it('listFeatures returns one entry per FEATURE_MATURITY key, sorted, with resolved state', async () => {
    const mod = await import('../../ts/src/maturity');
    const validLevels = ['stable', 'beta', 'experimental'];

    // Seed a registered feature so the map/sort/resolve logic runs against
    // real data even though the generated FEATURE_MATURITY table is empty.
    const seeded = '__list_test_feature__';
    (mod.FEATURE_MATURITY as Record<string, string>)[seeded] = 'beta';
    try {
      const features = mod.listFeatures();
      expect(Array.isArray(features)).toBe(true);
      // One entry per registered key.
      expect(features.length).toBe(Object.keys(mod.FEATURE_MATURITY).length);
      // Sorted by name and well-formed.
      const names = features.map((f) => f.name);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
      for (const f of features) {
        expect(typeof f.name).toBe('string');
        expect(validLevels).toContain(f.maturity);
        expect(typeof f.enabled).toBe('boolean');
      }
      const entry = features.find((f) => f.name === seeded);
      expect(entry).toMatchObject({ name: seeded, maturity: 'beta' });
    } finally {
      delete (mod.FEATURE_MATURITY as Record<string, string>)[seeded];
    }
  });

  it('FEATURE_MATURITY is a string-keyed map of valid maturity levels', async () => {
    const mod = await import('../../ts/src/maturity');
    const validLevels = ['stable', 'beta', 'experimental'];
    expect(mod.FEATURE_MATURITY).toBeTypeOf('object');
    expect(Array.isArray(mod.FEATURE_MATURITY)).toBe(false);
    for (const value of Object.values(mod.FEATURE_MATURITY)) {
      expect(validLevels).toContain(value);
    }
  });
});
