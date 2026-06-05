// Drift guard: every spec-declared `@activityType("…")` on a cursor
// hook event must be the exact string the runtime mapper passes to
// `session.activity()`. The hand-coded `activity-types.ts` enum used to
// be the only source of these values, which silently drifted from the
// canonical spec vocabulary (e.g., `agent_action` vs `ShellExecution`)
// and broke bootstrap rules that key off activity_type. The codegen
// emits one `<EVENT>_ACTIVITY_TYPE` constant per `@activityType`-decorated
// op; the runtime imports that constant. This test exercises each
// mapper with a capturing mock session and asserts it called
// `activity(eventCategory, <SpecConstant>, …)`.

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
}

function makeCapturingSession(captured: CapturedActivity[]) {
  return {
    activity: async (eventType: string, activityType: string) => {
      captured.push({ eventType, activityType });
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
      { conversation_id: 'c', file_path: '/tmp/x.txt', content: 'data' } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    expect(captured[0]?.activityType).toBe(BEFORE_READ_FILE_ACTIVITY_TYPE);
    expect(captured[0]?.activityType).toBe('FileRead');
  });

  test('beforeShellExecution fires ShellExecution', async () => {
    const captured: CapturedActivity[] = [];
    await handleBeforeShellExecution(
      { conversation_id: 'c', command: 'ls' } as never,
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

  // Observe-only events (after*) deliberately DO NOT call
  // session.activity. Pinning that contract here so a future
  // refactor can't accidentally re-introduce backend round-trips
  // for events that don't gate (which created phantom approval
  // rows in the dashboard panel and stalled the hook subprocess
  // in pollApproval for 25s; see commit history for details).
  test('afterAgentResponse emits no activity (observe-only)', async () => {
    const captured: CapturedActivity[] = [];
    await handleAfterAgentResponse(
      { conversation_id: 'c', response: 'r' } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    expect(captured).toHaveLength(0);
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
      { conversation_id: 'c', subagent_model: 'claude-opus', tool_call_id: 't1' } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    expect(captured[0]?.activityType).toBe(SUBAGENT_START_ACTIVITY_TYPE);
    expect(captured[0]?.activityType).toBe('SubagentStart');
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
