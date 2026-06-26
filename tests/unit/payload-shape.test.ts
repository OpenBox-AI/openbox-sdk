// Tests for spec-driven payload builders. Each @hookEvent op carries
// either @payloadShape (the emitter generates buildXPayload) or
// @noPayload (lifecycle-only ops). This file exercises the
// generated builders against representative envelopes; if the spec
// changes, regenerate, and the test reflects the new wire shape.

import { describe, expect, test } from 'vitest';
import * as cc from '../../ts/src/core-client/generated/runtime/claude-code.js';
import * as cur from '../../ts/src/core-client/generated/runtime/cursor.js';

describe('claude-code payload builders', () => {
  test('PreToolUse / Read uses sideEffects.readFile and alternate paths', () => {
    const env = {
      hook_event_name: 'PreToolUse',
      session_id: 's',
      tool_name: 'Read',
      tool_input: { filePath: '/etc/x' },
    } as cc.ClaudeCodeEnvelope;
    const payload = cc.buildPreToolUsePayload(env, 'Read', {
      readFile: () => 'FILE_CONTENT',
    });
    expect(payload.file_path).toBe('/etc/x');
    expect(payload.content).toBe('FILE_CONTENT');
    expect(payload.text).toBe('FILE_CONTENT');
    expect(payload.event_category).toBe('file_read');
  });

  test('PreToolUse / Bash pulls cwd default from envelope.cwd', () => {
    const env = {
      hook_event_name: 'PreToolUse',
      session_id: 's',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      cwd: '/tmp',
    } as cc.ClaudeCodeEnvelope;
    const payload = cc.buildPreToolUsePayload(env, 'Bash');
    expect(payload.command).toBe('ls');
    expect(payload.cwd).toBe('/tmp');
    expect(payload.event_category).toBe('agent_action');
  });

  test('PreToolUse default (mcp__*) falls through to mcp_tool_call category', () => {
    const env = {
      hook_event_name: 'PreToolUse',
      session_id: 's',
      tool_name: 'mcp__server__call',
      tool_input: { foo: 1 },
    } as cc.ClaudeCodeEnvelope;
    const payload = cc.buildPreToolUsePayload(env, 'mcp__server__call');
    expect(payload.tool_name).toBe('mcp__server__call');
    expect(payload.tool_input).toEqual({ foo: 1 });
    expect(payload.event_category).toBe('mcp_tool_call');
  });

  test('PostToolUse runs the stringifyTruncate side effect', () => {
    const env = {
      hook_event_name: 'PostToolUse',
      session_id: 's',
      tool_name: 'Bash',
      tool_response: { stdout: 'x'.repeat(10000) },
    } as cc.ClaudeCodeEnvelope;
    const payload = cc.buildPostToolUsePayload(env, {
      stringifyTruncate: (input) => {
        const s = typeof input === 'string' ? input : JSON.stringify(input);
        return s.slice(0, 50);
      },
    });
    expect((payload.output as string).length).toBeLessThanOrEqual(50);
    expect(payload.event_category).toBe('agent_observation');
  });

  test('UserPromptSubmit pulls prompt + model + sets llm_prompt category', () => {
    const env = {
      hook_event_name: 'UserPromptSubmit',
      session_id: 's',
      prompt: 'hello',
      model: 'claude-3-5',
    } as cc.ClaudeCodeEnvelope;
    const payload = cc.buildUserPromptSubmitPayload(env);
    expect(payload.text).toBe('hello');
    expect(payload.prompt).toBe('hello');
    expect(payload.model).toBe('claude-3-5');
    expect(payload.event_category).toBe('llm_prompt');
  });

  test('SessionStart fixes status="started" and pulls cwd', () => {
    const env = {
      hook_event_name: 'SessionStart',
      session_id: 's',
      cwd: '/repo',
    } as cc.ClaudeCodeEnvelope;
    expect(cc.buildSessionStartPayload(env)).toEqual({
      status: 'started',
      cwd: '/repo',
      event_category: 'workflow_start',
    });
  });
});

describe('cursor payload builders', () => {
  test('beforeReadFile pulls inlined `content` straight from envelope', () => {
    const env = {
      hook_event_name: 'beforeReadFile',
      conversation_id: 'c',
      file_path: '/x.ts',
      content: 'export const ok = 1;',
      generation_id: 'g',
    } as cur.CursorEnvelope;
    expect(cur.buildBeforeReadFilePayload(env)).toMatchObject({
      file_path: '/x.ts',
      content: 'export const ok = 1;',
      generation_id: 'g',
      event_category: 'file_read',
    });
  });

  test('beforeMCPExecution stringifies tool_input via side effect', () => {
    const env = {
      hook_event_name: 'beforeMCPExecution',
      conversation_id: 'c',
      tool_name: 't',
      tool_input: { a: 1 },
    } as cur.CursorEnvelope;
    const payload = cur.buildBeforeMCPExecutionPayload(env, {
      stringify: (i) => (typeof i === 'string' ? i : JSON.stringify(i)),
    });
    expect(payload.tool_input).toBe('{"a":1}');
    expect(payload.event_category).toBe('api_call');
  });

  test('preToolUse / Read uses sideEffects.readFile', () => {
    const env = {
      hook_event_name: 'preToolUse',
      conversation_id: 'c',
      tool_name: 'Read',
      tool_input: { file_path: '/y' },
    } as cur.CursorEnvelope;
    const payload = cur.buildPreToolUsePayload(env, 'Read', {
      readFile: () => 'BODY',
    });
    expect(payload.file_path).toBe('/y');
    expect(payload.content).toBe('BODY');
    expect(payload.event_category).toBe('file_read');
  });

  test('afterMCPExecution prefers result_json then runs extractMcpText', () => {
    const env = {
      hook_event_name: 'afterMCPExecution',
      conversation_id: 'c',
      tool_name: 't',
      result_json: '{"content":[{"type":"text","text":"hi"}]}',
      duration: 123,
    } as cur.CursorEnvelope;
    const payload = cur.buildAfterMCPExecutionPayload(env, {
      extractMcpText: (raw) => {
        const parsed = JSON.parse(raw as string) as { content: { type: string; text: string }[] };
        return parsed.content.map((c) => c.text).join('\n');
      },
    });
    expect(payload.tool_output).toBe('hi');
    expect(payload.duration_ms).toBe(123);
  });

  test('afterFileEdit preserves Cursor edit list for file-write accounting', () => {
    const env = {
      hook_event_name: 'afterFileEdit',
      conversation_id: 'c',
      file_path: '/tmp/x.ts',
      edits: [{ old_string: 'old', new_string: 'new' }],
      generation_id: 'g',
    } as cur.CursorEnvelope;
    expect(cur.buildAfterFileEditPayload(env)).toEqual({
      file_path: '/tmp/x.ts',
      edits: [{ old_string: 'old', new_string: 'new' }],
      generation_id: 'g',
      event_category: 'file_write',
    });
  });

  test('afterAgentResponse pulls response and sets llm_completion category', () => {
    const env = {
      hook_event_name: 'afterAgentResponse',
      conversation_id: 'c',
      response: 'ok',
      generation_id: 'g',
    } as cur.CursorEnvelope;
    expect(cur.buildAfterAgentResponsePayload(env)).toEqual({
      response: 'ok',
      generation_id: 'g',
      event_category: 'llm_completion',
    });
  });
});

describe('payload-shape coverage drift guard', () => {
  // Mirror the @hookEvent list from the spec. Every entry that's NOT
  // @noPayload should have a corresponding build<Op>Payload export. If
  // the spec adds a new @hookEvent + @payloadShape and the emitter
  // doesn't materialize the builder, this test fails.
  const claudeCodeBuilders = [
    'buildPreToolUsePayload',
    'buildPostToolUsePayload',
    'buildUserPromptSubmitPayload',
    'buildPermissionRequestPayload',
    'buildSessionStartPayload',
    'buildSessionEndPayload',
    'buildSubagentStartPayload',
    'buildSubagentStopPayload',
    'buildStopPayload',
  ];
  const cursorBuilders = [
    'buildBeforeSubmitPromptPayload',
    'buildBeforeReadFilePayload',
    'buildBeforeShellExecutionPayload',
    'buildBeforeMCPExecutionPayload',
    'buildPreToolUsePayload',
    'buildAfterAgentResponsePayload',
    'buildAfterAgentThoughtPayload',
    'buildAfterShellExecutionPayload',
    'buildAfterFileEditPayload',
    'buildAfterMCPExecutionPayload',
    'buildSessionStartPayload',
    'buildStopPayload',
  ];

  test('claude-code adapter exports a builder for every @payloadShape op', () => {
    const missing = claudeCodeBuilders.filter((b) => typeof (cc as Record<string, unknown>)[b] !== 'function');
    expect(missing).toEqual([]);
  });

  test('cursor adapter exports a builder for every @payloadShape op', () => {
    const missing = cursorBuilders.filter((b) => typeof (cur as Record<string, unknown>)[b] !== 'function');
    expect(missing).toEqual([]);
  });
});
