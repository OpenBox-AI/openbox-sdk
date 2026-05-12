// Spans-on-the-wire drift guard.
//
// Behavior rules require spans in the evaluate payload (per
// `skill/references/span-reference.md`); without them, the backend
// classifier has nothing to read and every rule silently no-ops.
// This test invokes each cursor mapper with a capturing mock session
// and asserts: (a) `spans` is populated, (b) the first span carries
// the right `semantic_type`, and (c) the gate attribute the classifier
// reads (file.path / shell.command / http.method+url + gen_ai.system)
// is present.

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

interface ActivityCall {
  eventType: string;
  activityType: string;
  payload: { input?: unknown[]; spans?: unknown[] };
}

function makeCapturingSession(captured: ActivityCall[]) {
  return {
    activity: async (eventType: string, activityType: string, payload: { input: unknown[]; spans?: unknown[] }) => {
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
  test('beforeSubmitPrompt → llm_completion span with gen_ai.system + http.method/url', async () => {
    const captured: ActivityCall[] = [];
    await handleBeforeSubmitPrompt(
      { conversation_id: 'c', prompt: 'hi' } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    const main = captured.find((c) => c.eventType === 'ActivityStarted');
    expect(main?.payload.spans).toHaveLength(1);
    const span = (main?.payload.spans?.[0] ?? {}) as SpanShape;
    expect(span.semantic_type).toBe('llm_completion');
    expect(span.attributes?.['http.method']).toBe('POST');
    expect(span.attributes?.['gen_ai.system']).toBeDefined();
  });

  test('beforeReadFile → file_read span with file.path attribute', async () => {
    const captured: ActivityCall[] = [];
    await handleBeforeReadFile(
      { conversation_id: 'c', file_path: '/etc/passwd', content: 'x' } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    const span = (captured[0]?.payload.spans?.[0] ?? {}) as SpanShape;
    expect(span.semantic_type).toBe('file_read');
    expect(span.attributes?.['file.path']).toBe('/etc/passwd');
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
  });

  // after* events are no-ops on the SDK side (don't call session.activity);
  // see ts/src/runtime/cursor/mappers/observe.ts for why. Pin that here.
  test('after* events emit no spans (observe-only, no backend round-trip)', async () => {
    const captured: ActivityCall[] = [];
    await handleAfterAgentResponse(
      { conversation_id: 'c', response: 'r' } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
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
