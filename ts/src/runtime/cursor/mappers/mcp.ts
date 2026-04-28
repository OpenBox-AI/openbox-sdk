import type {
  CursorSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { CursorEnvelope } from '../../../core-client/generated/runtime/cursor.js';
import { buildBeforeMCPExecutionPayload } from '../../../core-client/generated/runtime/cursor.js';
import type { CursorConfig } from '../config.js';
import { markHalted } from '../session-resolver.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';
import { sideEffects } from '../side-effects.js';

/** beforeMCPExecution: govern an MCP tool call before Cursor invokes it. */
export async function handleBeforeMCPExecution(
  env: CursorEnvelope,
  session: CursorSession,
  cfg: CursorConfig,
): Promise<WorkflowVerdict | undefined> {
  const toolName = env.tool_name ?? '';
  if (!toolName) return undefined;

  const payload = buildBeforeMCPExecutionPayload(env, sideEffects);
  const verdict = await session.activity(EVENT.START, ACTIVITY_TYPES.API_CALL, { input: [payload] });
  if (verdict.arm === 'halt') markHalted(env.conversation_id, cfg);
  return verdict;
}
