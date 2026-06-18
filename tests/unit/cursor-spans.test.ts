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

import { describe, expect, test } from 'vitest';
import { handleBeforeSubmitPrompt } from '../../ts/src/runtime/cursor/mappers/prompt.js';
import { handleBeforeReadFile } from '../../ts/src/runtime/cursor/mappers/file-read.js';
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
  payload: { input?: unknown[]; output?: unknown; spans?: unknown[] };
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
    workflowStarted: async () => undefined,
    workflowCompleted: async () => undefined,
  };
}

const cfg = { idleTimeoutMs: 60_000, sessionStorePath: '' } as never;

interface SpanShape {
  semantic_type?: string;
  attributes?: Record<string, unknown>;
}

describe('cursor mappers emit spans for behavior-rule matching', () => {
  test('beforeSubmitPrompt emits prompt telemetry without a synthetic prompt span', async () => {
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
    });
    expect(main?.payload.spans).toBeUndefined();
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

  test('beforeMCPExecution → llm_tool_call span with gen_ai.system+http.url', async () => {
    const captured: ActivityCall[] = [];
    await handleBeforeMCPExecution(
      { conversation_id: 'c', tool_name: 'fetch', tool_input: {} } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    const span = (captured[0]?.payload.spans?.[0] ?? {}) as SpanShape;
    expect(span.semantic_type).toBe('llm_tool_call');
    expect(span.attributes?.['http.method']).toBe('POST');
    expect(span.attributes?.['gen_ai.system']).toBe('mcp');
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
          usage: {
            input_tokens: 12,
            output_tokens: 5,
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
      total_tokens: 17,
      attributes: {
        'gen_ai.system': 'cursor',
        'gen_ai.response.model': 'gemini-2.5-flash',
        'gen_ai.usage.input_tokens': 12,
        'gen_ai.usage.output_tokens': 5,
        'gen_ai.usage.total_tokens': 17,
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
      { conversation_id: 'c', file_path: '/tmp/x.txt' } as never,
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
