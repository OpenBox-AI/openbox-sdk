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
import { EVENT } from '../activity-types.js';
import { sideEffects } from '../side-effects.js';
import { buildSpan, withOpenBoxActivityMetadata } from '../../../governance/spans.js';
import { stampSource } from '../../../approvals/source.js';

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
  const verdict = await session.activity(
    EVENT.START,
    BEFORE_MCPEXECUTION_ACTIVITY_TYPE,
    {
      input: withOpenBoxActivityMetadata(
        [stampSource(payload, 'cursor')],
        { toolType: 'mcp' },
      ),
      spans: [span],
    },
  );
  if (verdict.arm === 'halt') markHalted(env.conversation_id, cfg);
  return verdict;
}
