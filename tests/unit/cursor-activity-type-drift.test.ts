// Drift guard: cursor mappers must emit the activity_type declared in TypeSpec
// for each hook event.

import { describe, expect, test } from 'vitest';
import {
  BEFORE_SUBMIT_PROMPT_ACTIVITY_TYPE,
  BEFORE_READ_FILE_ACTIVITY_TYPE,
  BEFORE_SHELL_EXECUTION_ACTIVITY_TYPE,
  BEFORE_MCPEXECUTION_ACTIVITY_TYPE,
  AFTER_AGENT_RESPONSE_ACTIVITY_TYPE,
  AFTER_AGENT_THOUGHT_ACTIVITY_TYPE,
  AFTER_SHELL_EXECUTION_ACTIVITY_TYPE,
  AFTER_FILE_EDIT_ACTIVITY_TYPE,
  AFTER_MCPEXECUTION_ACTIVITY_TYPE,
  BEFORE_TAB_FILE_READ_ACTIVITY_TYPE,
  SUBAGENT_START_ACTIVITY_TYPE,
} from '../../ts/src/core-client/generated/runtime/cursor.js';
import { handleBeforeSubmitPrompt } from '../../ts/src/runtime/cursor/mappers/prompt.js';
import { handleBeforeReadFile, handleBeforeTabFileRead } from '../../ts/src/runtime/cursor/mappers/file-read.js';
import { handleBeforeShellExecution } from '../../ts/src/runtime/cursor/mappers/shell.js';
import { handleBeforeMCPExecution } from '../../ts/src/runtime/cursor/mappers/mcp.js';
import { handleAfterMCPExecution } from '../../ts/src/runtime/cursor/mappers/mcp-response.js';
import { handleSubagentStart } from '../../ts/src/runtime/cursor/mappers/subagent.js';
import {
  handleAfterAgentResponse,
  handleAfterAgentThought,
  handleAfterShellExecution,
  handleAfterFileEdit,
  handleAfterTabFileEdit,
  handlePreCompact,
  handleSubagentStop,
} from '../../ts/src/runtime/cursor/mappers/observe.js';

interface CapturedActivity {
  eventType: string;
  activityType: string;
  method: 'activity' | 'observeActivity';
  payload?: any;
}

function makeCapturingSession(captured: CapturedActivity[]) {
  return {
    activity: async (eventType: string, activityType: string, payload?: any) => {
      captured.push({ eventType, activityType, payload, method: 'activity' });
      return { arm: 'allow' as const, decision: { decisionId: 'd' } };
    },
    observeActivity: async (eventType: string, activityType: string, payload?: any) => {
      captured.push({ eventType, activityType, payload, method: 'observeActivity' });
      return { arm: 'allow' as const, decision: { decisionId: 'd' } };
    },
    workflowStarted: async () => undefined,
    workflowCompleted: async () => undefined,
  };
}

const cfg = { idleTimeoutMs: 60_000, sessionStorePath: '' } as never;

describe('spec @activityType ↔ runtime activity_type parity (cursor)', () => {
  test('beforeSubmitPrompt fires PromptSubmission', async () => {
    const captured: CapturedActivity[] = [];
    await handleBeforeSubmitPrompt(
      { conversation_id: 'c', prompt: 'hello' } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    const main = captured.find((c) => c.eventType === 'ActivityStarted');
    expect(main?.activityType).toBe(BEFORE_SUBMIT_PROMPT_ACTIVITY_TYPE);
    expect(main?.activityType).toBe('PromptSubmission');
  });

  test('beforeReadFile fires FileRead', async () => {
    const captured: CapturedActivity[] = [];
    await handleBeforeReadFile(
      {
        conversation_id: 'c',
        generation_id: 'activity-type-read-' + Math.random().toString(36).slice(2),
        file_path: '/tmp/x.txt',
        content: 'data',
      } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    expect(captured[0]?.activityType).toBe(BEFORE_READ_FILE_ACTIVITY_TYPE);
    expect(captured[0]?.activityType).toBe('FileRead');
  });

  test('beforeShellExecution fires ShellExecution', async () => {
    const captured: CapturedActivity[] = [];
    await handleBeforeShellExecution(
      {
        conversation_id: 'c',
        generation_id: 'activity-type-shell-' + Math.random().toString(36).slice(2),
        command: 'ls',
      } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    expect(captured[0]?.activityType).toBe(BEFORE_SHELL_EXECUTION_ACTIVITY_TYPE);
    expect(captured[0]?.activityType).toBe('ShellExecution');
  });

  test('beforeMCPExecution fires MCPToolCall', async () => {
    const captured: CapturedActivity[] = [];
    await handleBeforeMCPExecution(
      { conversation_id: 'c', tool_name: 'fetch', tool_input: {} } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    expect(captured[0]?.activityType).toBe(BEFORE_MCPEXECUTION_ACTIVITY_TYPE);
    expect(captured[0]?.activityType).toBe('MCPToolCall');
  });

  // Most observe-only events deliberately do not call session.activity.
  // afterAgentResponse is the exception: it emits an observeActivity
  // assistant-output event so Core can store completion spans without
  // blocking an already-completed host action.
  test('afterAgentResponse emits observe-only LLMCompleted', async () => {
    const captured: CapturedActivity[] = [];
    await handleAfterAgentResponse(
      { conversation_id: 'c', response: 'r' } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      eventType: 'ActivityCompleted',
      activityType: AFTER_AGENT_RESPONSE_ACTIVITY_TYPE,
      method: 'observeActivity',
    });
    expect(captured[0]?.activityType).toBe('LLMCompleted');
  });
  test('afterAgentThought emits no activity', async () => {
    const captured: CapturedActivity[] = [];
    await handleAfterAgentThought(
      { conversation_id: 'c', thought: 't' } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    expect(captured).toHaveLength(0);
  });
  test('afterShellExecution emits no activity', async () => {
    const captured: CapturedActivity[] = [];
    await handleAfterShellExecution(
      { conversation_id: 'c', command: 'ls' } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    expect(captured).toHaveLength(0);
  });
  test('afterFileEdit emits no activity', async () => {
    const captured: CapturedActivity[] = [];
    await handleAfterFileEdit(
      { conversation_id: 'c', file_path: '/tmp/y.txt' } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    expect(captured).toHaveLength(0);
  });
  test('afterMCPExecution emits no activity', async () => {
    const captured: CapturedActivity[] = [];
    await handleAfterMCPExecution(
      { conversation_id: 'c', tool_name: 'fetch', tool_output: 'ok' } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    expect(captured).toHaveLength(0);
  });

  // ─── Extended event coverage ───────────────────────────────────────────
  test('beforeTabFileRead fires FileRead', async () => {
    const captured: CapturedActivity[] = [];
    await handleBeforeTabFileRead(
      { conversation_id: 'c', file_path: '/etc/passwd', content: 'x' } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    expect(captured[0]?.activityType).toBe(BEFORE_TAB_FILE_READ_ACTIVITY_TYPE);
    expect(captured[0]?.activityType).toBe('FileRead');
  });

  test('subagentStart fires SubagentStart', async () => {
    const captured: CapturedActivity[] = [];
    await handleSubagentStart(
      {
        conversation_id: 'c',
        subagent_type: 'researcher',
        subagent_model: 'claude-opus',
        tool_call_id: 't1',
      } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    expect(captured[0]?.activityType).toBe(SUBAGENT_START_ACTIVITY_TYPE);
    expect(captured[0]?.activityType).toBe('SubagentStart');
    expect(captured[0]?.payload?.input).toContainEqual({
      __openbox: { tool_type: 'a2a', subagent_name: 'researcher' },
    });
  });

  test('afterTabFileEdit emits no activity (observe-only)', async () => {
    const captured: CapturedActivity[] = [];
    await handleAfterTabFileEdit(
      { conversation_id: 'c', file_path: '/tmp/x.txt' } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    expect(captured).toHaveLength(0);
  });

  test('preCompact emits no activity (observe-only)', async () => {
    const captured: CapturedActivity[] = [];
    await handlePreCompact(
      { conversation_id: 'c' } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    expect(captured).toHaveLength(0);
  });

  test('subagentStop emits no activity (observe-only)', async () => {
    const captured: CapturedActivity[] = [];
    await handleSubagentStop(
      { conversation_id: 'c' } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    expect(captured).toHaveLength(0);
  });
});
