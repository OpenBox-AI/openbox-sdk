// Cursor mapper span-shape drift guard.
//
// Behavior rules require a backend-readable span shape. The shared
// governed session is responsible for splitting mapper payloads into
// the final parent-plus-hook wire contract; this test stays at the
// mapper boundary and asserts: (a) prompt gates keep their signal/root
// telemetry without synthetic prompt spans, (b) tool/output spans are
// populated before the session layer, and (c) the gate attribute the
// classifier reads (file.path / shell.command / http.method+url +
// gen_ai.system) is present.

import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, test } from 'vitest';
import { handleBeforeSubmitPrompt } from '../../ts/src/runtime/cursor/mappers/prompt.js';
import {
  handleBeforeReadFile,
  handleBeforeTabFileRead,
} from '../../ts/src/runtime/cursor/mappers/file-read.js';
import { handleBeforeShellExecution } from '../../ts/src/runtime/cursor/mappers/shell.js';
import { handleBeforeMCPExecution } from '../../ts/src/runtime/cursor/mappers/mcp.js';
import { handleAfterMCPExecution } from '../../ts/src/runtime/cursor/mappers/mcp-response.js';
import {
  handleAfterAgentResponse,
  handleAfterAgentThought,
  handleAfterShellExecution,
  handleAfterFileEdit,
} from '../../ts/src/runtime/cursor/mappers/observe.js';
import {
  handlePostToolUse,
  handlePostToolUseFailure,
} from '../../ts/src/runtime/cursor/mappers/tool-completion.js';

interface ActivityCall {
  eventType: string;
  activityType: string;
  payload: {
    activityId?: string;
    startTime?: number;
    input?: unknown[];
    output?: unknown;
    spans?: unknown[];
  };
}

function makeCapturingSession(captured: ActivityCall[]) {
  return {
    activity: async (eventType: string, activityType: string, payload: { input?: unknown[]; spans?: unknown[] }) => {
      captured.push({ eventType, activityType, payload });
      return { arm: 'allow' as const };
    },
    observeActivity: async (eventType: string, activityType: string, payload: { input?: unknown[]; spans?: unknown[] }) => {
      captured.push({ eventType, activityType, payload });
      return { arm: 'allow' as const };
    },
    openActivity: async (activityType: string, payload: ActivityCall['payload']) => {
      const activityId = payload.activityId ?? `cursor-open-${captured.length + 1}`;
      const startTime = payload.startTime ?? Date.now();
      captured.push({
        eventType: 'ActivityStarted',
        activityType,
        payload: { ...payload, activityId, startTime },
      });
      return {
        activityId,
        verdict: { arm: 'allow' as const },
        complete: async (
          completionPayload: ActivityCall['payload'],
          completionActivityType?: string,
        ) => {
          captured.push({
            eventType: 'ActivityCompleted',
            activityType: completionActivityType ?? activityType,
            payload: { ...completionPayload, activityId },
          });
          return { arm: 'allow' as const };
        },
      };
    },
    workflowStarted: async () => undefined,
    workflowCompleted: async () => undefined,
  };
}

const cfg = {
  hitlMaxWait: 1,
  idleTimeoutMs: 60_000,
  sessionDir: path.join(tmpdir(), 'openbox-cursor-spans-test'),
  sessionStorePath: '',
} as never;

interface SpanShape {
  semantic_type?: string;
  attributes?: Record<string, unknown>;
  status?: { code?: string; description?: string | null };
  error?: unknown;
}

describe('cursor mappers emit spans for behavior-rule matching', () => {
  test('beforeSubmitPrompt emits prompt telemetry with an LLM classifier span', async () => {
    const captured: ActivityCall[] = [];
    await handleBeforeSubmitPrompt(
      { conversation_id: 'c', prompt: 'hi' } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    const signal = captured.find((c) => c.eventType === 'SignalReceived');
    expect(signal?.activityType).toBe('user_prompt');
    expect(signal?.payload).toMatchObject({
      signalName: 'user_prompt',
      signalArgs: 'hi',
      sessionId: 'c',
      prompt: 'hi',
    });
    expect(signal?.payload.spans).toBeUndefined();
    const main = captured.find((c) => c.eventType === 'ActivityStarted');
    expect(main?.activityType).toBe('PromptSubmission');
    expect(main?.payload).toMatchObject({
      sessionId: 'c',
      prompt: 'hi',
      toolType: 'llm',
    });
    expect(main?.payload.spans?.[0]).toMatchObject({
      module: 'cursor',
      name: 'llm.chat.completion',
      semantic_type: 'llm_completion',
      attributes: expect.objectContaining({
        'gen_ai.system': 'cursor',
        'http.method': 'POST',
      }),
    });
  });

  test('beforeReadFile → file_read span with file.path attribute', async () => {
    const captured: ActivityCall[] = [];
    await handleBeforeReadFile(
      {
        conversation_id: 'c',
        generation_id: 'spans-read-' + Math.random().toString(36).slice(2),
        file_path: '/etc/passwd',
        content: 'x',
      } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    const span = (captured[0]?.payload.spans?.[0] ?? {}) as SpanShape;
    expect(span.semantic_type).toBe('file_read');
    expect(span.attributes?.['file.path']).toBe('/etc/passwd');
    expect(span.attributes?.['openbox.tool.name']).toBe('Read');
    expect(span.attributes?.['tool.name']).toBe('Read');
  });

  test('beforeTabFileRead -> file_open span with file.path attribute', async () => {
    const captured: ActivityCall[] = [];
    await handleBeforeTabFileRead(
      {
        conversation_id: 'c',
        generation_id: 'spans-open-' + Math.random().toString(36).slice(2),
        file_path: '/etc/openbox-sensitive.env',
        content: 'x',
      } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    const span = (captured[0]?.payload.spans?.[0] ?? {}) as SpanShape;
    expect(captured[0]?.activityType).toBe('FileRead');
    expect(span.semantic_type).toBe('file_open');
    expect(span.attributes?.['file.path']).toBe('/etc/openbox-sensitive.env');
    expect(span.attributes?.['file.operation']).toBe('open');
    expect(span.attributes?.['openbox.tool.name']).toBe('TabRead');
    expect(span.attributes?.['tool.name']).toBe('TabRead');
  });

  test('beforeShellExecution → internal span with shell.command attribute', async () => {
    const captured: ActivityCall[] = [];
    await handleBeforeShellExecution(
      {
        conversation_id: 'c',
        // Unique generation_id so this test does not collide with
        // the dedup lock that may have been written by a sibling
        // mapper test in the same vitest run.
        generation_id: 'spans-internal-' + Math.random().toString(36).slice(2),
        command: 'echo hello world',
        cwd: '/tmp',
      } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    const span = (captured[0]?.payload.spans?.[0] ?? {}) as SpanShape;
    // Plain shell classifies as `internal` per behaviors.md (no
    // shell trigger). rm/unlink/rmdir/shred reroute to file_delete
    // via the @activityVariant; covered separately below.
    expect(span.semantic_type).toBe('internal');
    expect(span.attributes?.['shell.command']).toBe('echo hello world');
    expect(span.attributes?.['openbox.tool.name']).toBe('Shell');
    expect(span.attributes?.['tool.name']).toBe('Shell');
  });

  test('before/after shell execution keeps one activity id across the tool lifecycle', async () => {
    const captured: ActivityCall[] = [];
    const suffix = Math.random().toString(36).slice(2);
    const command = `npm run cursor-shell-lifecycle-${suffix}`;
    const envelope = {
      conversation_id: 'c',
      generation_id: `cursor-shell-lifecycle-${suffix}`,
      command,
      cwd: '/repo',
      hook_event_name: 'beforeShellExecution',
      workspace_roots: ['/repo'],
    };

    await handleBeforeShellExecution(
      envelope as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    await handleAfterShellExecution(
      {
        ...envelope,
        hook_event_name: 'afterShellExecution',
        output: 'ok',
        duration: 42,
      } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );

    expect(captured).toHaveLength(2);
    expect(captured[0]).toMatchObject({
      eventType: 'ActivityStarted',
      activityType: 'ShellExecution',
    });
    expect(captured[1]).toMatchObject({
      eventType: 'ActivityCompleted',
      activityType: 'ShellExecution',
      payload: {
        activityId: captured[0]?.payload.activityId,
        startTime: captured[0]?.payload.startTime,
        durationMs: 42,
      },
    });
  });

  test('beforeShellExecution(rm) → file_delete span (FileDelete reroute)', async () => {
    const captured: ActivityCall[] = [];
    await handleBeforeShellExecution(
      {
        conversation_id: 'c',
        generation_id: 'spans-delete-' + Math.random().toString(36).slice(2),
        command: 'rm -rf /tmp/x',
        cwd: '/tmp',
      } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    const span = (captured[0]?.payload.spans?.[0] ?? {}) as SpanShape;
    expect(span.semantic_type).toBe('file_delete');
    expect(span.attributes?.['openbox.tool.name']).toBe('Shell');
    expect(span.attributes?.['tool.name']).toBe('Shell');
    expect(captured[0]?.activityType).toBe('FileDelete');
  });

  test('beforeMCPExecution -> mcp_tool_call span with Core MCP classifier fields', async () => {
    const captured: ActivityCall[] = [];
    await handleBeforeMCPExecution(
      { conversation_id: 'c', tool_name: 'fetch', tool_input: {} } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    const span = (captured[0]?.payload.spans?.[0] ?? {}) as SpanShape;
    expect(span.semantic_type).toBe('mcp_tool_call');
    expect(span.attributes?.['mcp.method']).toBe('callTool');
    expect(span.attributes?.['mcp.operation']).toBe('fetch');
    expect(span.attributes?.['mcp.server_id']).toBe('unknown');
    expect(span.attributes?.['openbox.tool.name']).toBe('fetch');
    expect(span.attributes?.['tool.name']).toBe('fetch');
  });

  test('afterAgentResponse emits completed assistant-output span', async () => {
    const captured: ActivityCall[] = [];
    await handleAfterAgentResponse(
      {
        conversation_id: 'c',
        response: {
          content: [{ type: 'text', text: 'Cursor answer.' }],
          additional_kwargs: {
            tool_calls: [{ id: 'call-1', name: 'read_file' }],
          },
        },
        response_metadata: {
          ls_model_name: 'gemini-2.5-flash',
          usageMetadata: {
            promptTokenCount: 12,
            candidatesTokenCount: 5,
            totalTokenCount: 17,
          },
        },
      } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]?.eventType).toBe('ActivityCompleted');
    expect(captured[0]?.activityType).toBe('LLMCompleted');
    expect(captured[0]?.payload).toMatchObject({
      llmModel: 'gemini-2.5-flash',
      inputTokens: 12,
      outputTokens: 5,
      totalTokens: 17,
      hasToolCalls: true,
    });
    const span = (captured[0]?.payload.spans?.[0] ?? {}) as SpanShape;
    expect(span).toMatchObject({
      semantic_type: 'llm_completion',
      model: 'gemini-2.5-flash',
      http_url: 'https://generativelanguage.googleapis.com/v1beta/models/generateContent',
      total_tokens: 17,
      attributes: {
        'gen_ai.system': 'cursor',
        'gen_ai.response.model': 'gemini-2.5-flash',
        'gen_ai.usage.input_tokens': 12,
        'gen_ai.usage.output_tokens': 5,
        'gen_ai.usage.total_tokens': 17,
        'http.url': 'https://generativelanguage.googleapis.com/v1beta/models/generateContent',
        'openbox.cursor.event': 'afterAgentResponse',
      },
    });
    expect(JSON.parse(String((span as any).response_body)).usage).toMatchObject({
      input_tokens: 12,
      output_tokens: 5,
      total_tokens: 17,
    });
    expect(
      JSON.parse(String((span as any).response_body)).choices[0].message.content,
    ).toBe('Cursor answer.');
  });

  test('postToolUse emits completed tool telemetry when Cursor supplies payload', async () => {
    const captured: ActivityCall[] = [];
    const suffix = Math.random().toString(36).slice(2);
    const command = `npm test --cursor-post-unit-${suffix}`;
    await handlePostToolUse(
      {
        hook_event_name: 'postToolUse',
        conversation_id: 'c',
        generation_id: `post-tool-unit-${suffix}`,
        tool_name: 'Shell',
        tool_use_id: 'tool-1',
        tool_input: { command, cwd: '/repo' },
        tool_output: '{"exitCode":0,"stdout":"ok"}',
        cwd: '/repo',
        model: 'claude-sonnet-4-20250514',
        duration: 123,
      } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      eventType: 'ActivityCompleted',
      activityType: 'ShellExecution',
      payload: {
        activityId: 'tool-1',
        durationMs: 123,
        sessionId: 'c',
        llmModel: 'claude-sonnet-4-20250514',
        toolName: 'Shell',
        toolType: 'shell',
      },
    });
    const span = (captured[0]?.payload.spans?.[0] ?? {}) as SpanShape;
    expect(span.semantic_type).toBe('internal');
    expect(span.attributes?.['shell.command']).toBe(command);
    expect(span.attributes?.['openbox.tool.name']).toBe('Shell');
    expect(captured[0]?.payload.output).toMatchObject({
      tool_output: '{"exitCode":0,"stdout":"ok"}',
      duration_ms: 123,
      model: 'claude-sonnet-4-20250514',
      _openbox_source: 'cursor',
    });
  });

  test('postToolUseFailure emits failure telemetry when Cursor supplies payload', async () => {
    const captured: ActivityCall[] = [];
    const suffix = Math.random().toString(36).slice(2);
    const filePath = `/secret-${suffix}.txt`;
    await handlePostToolUseFailure(
      {
        hook_event_name: 'postToolUseFailure',
        conversation_id: 'c',
        generation_id: `post-tool-failure-unit-${suffix}`,
        tool_name: 'Read',
        tool_use_id: 'tool-2',
        tool_input: { file_path: filePath },
        error_message: 'permission denied',
        failure_type: 'permission_denied',
        duration: 50,
      } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      eventType: 'ActivityCompleted',
      activityType: 'FileRead',
      payload: {
        activityId: 'tool-2',
        durationMs: 50,
        finishReason: 'permission_denied',
        toolName: 'Read',
        toolType: 'file_read',
      },
    });
    const span = (captured[0]?.payload.spans?.[0] ?? {}) as SpanShape;
    expect(span.semantic_type).toBe('file_read');
    expect(span.attributes?.['file.path']).toBe(filePath);
    expect(span.status).toEqual({
      code: 'ERROR',
      description: 'permission denied',
    });
    expect(span.error).toBe('permission denied');
    expect(captured[0]?.payload.output).toMatchObject({
      error_message: 'permission denied',
      failure_type: 'permission_denied',
      _openbox_source: 'cursor',
    });
  });

  test('afterShellExecution emits completed shell telemetry when Cursor supplies output or duration', async () => {
    const captured: ActivityCall[] = [];
    const suffix = Math.random().toString(36).slice(2);
    const command = `npm run cursor-after-shell-${suffix}`;
    await handleAfterShellExecution(
      {
        hook_event_name: 'afterShellExecution',
        conversation_id: 'c',
        generation_id: `after-shell-unit-${suffix}`,
        command,
        cwd: '/repo',
        output: 'shell completed',
        duration: 321,
        sandbox: false,
      } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      eventType: 'ActivityCompleted',
      activityType: 'ShellExecution',
      payload: {
        durationMs: 321,
        sessionId: 'c',
        toolName: 'Shell',
        toolType: 'shell',
      },
    });
    const span = (captured[0]?.payload.spans?.[0] ?? {}) as SpanShape;
    expect(span.semantic_type).toBe('internal');
    expect(span.attributes?.['shell.command']).toBe(command);
    expect(span.attributes?.['openbox.tool.name']).toBe('Shell');
    expect(captured[0]?.payload.output).toMatchObject({
      command,
      output: 'shell completed',
      duration_ms: 321,
      sandbox: false,
      _openbox_source: 'cursor',
    });
  });

  test('afterMCPExecution emits completed MCP telemetry when Cursor supplies result JSON', async () => {
    const captured: ActivityCall[] = [];
    const suffix = Math.random().toString(36).slice(2);
    await handleAfterMCPExecution(
      {
        hook_event_name: 'afterMCPExecution',
        conversation_id: 'c',
        generation_id: `after-mcp-unit-${suffix}`,
        tool_name: `openbox.lookup_${suffix}`,
        tool_input: { query: 'status' },
        result_json: '{"content":[{"type":"text","text":"mcp completed"}]}',
        duration: 222,
      } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      eventType: 'ActivityCompleted',
      activityType: 'MCPToolCall',
      payload: {
        durationMs: 222,
        sessionId: 'c',
        toolType: 'mcp',
      },
    });
    const span = (captured[0]?.payload.spans?.[0] ?? {}) as SpanShape;
    expect(span.semantic_type).toBe('mcp_tool_call');
    expect(span.attributes?.['mcp.method']).toBe('callTool');
    expect(span.attributes?.['mcp.operation']).toBe(`openbox.lookup_${suffix}`);
    expect(span.attributes?.['mcp.server_id']).toBe('unknown');
    expect(span.attributes?.['openbox.tool.name']).toBe(`openbox.lookup_${suffix}`);
    expect(span.attributes?.['tool.name']).toBe(`openbox.lookup_${suffix}`);
    expect(captured[0]?.payload.output).toMatchObject({
      tool_name: `openbox.lookup_${suffix}`,
      tool_output: 'mcp completed',
      duration_ms: 222,
      _openbox_source: 'cursor',
    });
  });

  test('afterFileEdit emits completed file-write telemetry when Cursor supplies edit payload', async () => {
    const captured: ActivityCall[] = [];
    const suffix = Math.random().toString(36).slice(2);
    const filePath = `/tmp/cursor-after-file-${suffix}.ts`;
    await handleAfterFileEdit(
      {
        hook_event_name: 'afterFileEdit',
        conversation_id: 'c',
        generation_id: `after-file-unit-${suffix}`,
        file_path: filePath,
        edits: [{ old_string: 'old', new_string: 'new' }],
      } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      eventType: 'ActivityCompleted',
      activityType: 'FileEdit',
      payload: {
        sessionId: 'c',
        toolName: 'FileEdit',
        toolType: 'file_write',
      },
    });
    const span = (captured[0]?.payload.spans?.[0] ?? {}) as SpanShape;
    expect(span.semantic_type).toBe('file_write');
    expect(span.attributes?.['file.path']).toBe(filePath);
    expect(span.attributes?.['file.operation']).toBe('write');
    expect(span.attributes?.['openbox.tool.name']).toBe('FileEdit');
    expect(captured[0]?.payload.output).toMatchObject({
      file_path: filePath,
      edits: [{ old_string: 'old', new_string: 'new' }],
      event_category: 'file_write',
      _openbox_source: 'cursor',
    });
  });

  test('non-response after* events remain observe-only without backend spans', async () => {
    const captured: ActivityCall[] = [];
    await handleAfterAgentThought(
      { conversation_id: 'c', thought: 't' } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    await handleAfterShellExecution(
      { conversation_id: 'c', command: 'ls' } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    await handleAfterFileEdit(
      { conversation_id: 'c' } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    await handleAfterMCPExecution(
      { conversation_id: 'c', tool_name: 'fetch', tool_output: 'ok' } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    expect(captured).toHaveLength(0);
  });
});
