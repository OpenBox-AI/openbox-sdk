import type {
  CursorSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { CursorEnvelope } from '../../../core-client/generated/runtime/cursor.js';
import {
  buildBeforeMCPExecutionPayload,
  BEFORE_MCPEXECUTION_ACTIVITY_TYPE,
} from '../../../core-client/generated/runtime/cursor.js';
import type { CursorConfig } from '../config.js';
import { markHalted } from '../session-resolver.js';
import { sideEffects } from '../side-effects.js';
import { buildSpan, withOpenBoxActivityMetadata } from '../../../governance/spans.js';
import { stampSource } from '../../../approvals/source.js';
import { rememberCompletionActivity } from '../dedup.js';

/** beforeMCPExecution: govern an MCP tool call before Cursor invokes it. */
export async function handleBeforeMCPExecution(
  env: CursorEnvelope,
  session: CursorSession,
  cfg: CursorConfig,
): Promise<WorkflowVerdict | undefined> {
  const toolName = env.tool_name ?? '';
  if (!toolName) return undefined;

  const payload = buildBeforeMCPExecutionPayload(env, sideEffects);
  const span = buildSpan('cursor', 'mcp', { tool_name: toolName, tool_input: env.tool_input });
  const startTime = Date.now();
  const opened = await session.openActivity(BEFORE_MCPEXECUTION_ACTIVITY_TYPE, {
    input: withOpenBoxActivityMetadata(
      [stampSource(payload, 'cursor')],
      { toolType: 'mcp' },
    ),
    startTime,
    spans: [span],
  });
  const verdict = opened.verdict;
  if (
    verdict.arm === 'allow' ||
    verdict.arm === 'constrain' ||
    verdict.arm === 'require_approval'
  ) {
    rememberCompletionActivity(
      {
        generation_id: env.generation_id,
        conversation_id: env.conversation_id,
        kind: 'mcp',
        arg: toolName,
      },
      cfg,
      {
        activityId: opened.activityId,
        activityType: BEFORE_MCPEXECUTION_ACTIVITY_TYPE,
        startTime,
      },
    );
  }
  if (verdict.arm === 'halt') markHalted(env.conversation_id, cfg);
  return verdict;
}
