import type {
  CursorSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { CursorEnvelope } from '../../../core-client/generated/runtime/cursor.js';
import { buildBeforeShellExecutionPayload } from '../../../core-client/generated/runtime/cursor.js';
import type { CursorConfig } from '../config.js';
import { markHalted } from '../session-resolver.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';

/** beforeShellExecution: govern shell command before Cursor runs it. */
export async function handleBeforeShellExecution(
  env: CursorEnvelope,
  session: CursorSession,
  cfg: CursorConfig,
): Promise<WorkflowVerdict | undefined> {
  const command = env.command ?? '';
  if (!command) return undefined;

  const payload = buildBeforeShellExecutionPayload(env);
  const verdict = await session.activity(EVENT.START, ACTIVITY_TYPES.AGENT_ACTION, { input: [payload] });
  if (verdict.arm === 'halt') markHalted(env.conversation_id, cfg);
  return verdict;
}
