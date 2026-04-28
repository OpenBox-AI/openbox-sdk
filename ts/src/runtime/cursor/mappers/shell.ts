import type {
  CursorSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { CursorEnvelope } from '../../../core-client/generated/runtime/cursor.js';
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

  const verdict = await session.activity(EVENT.START, ACTIVITY_TYPES.AGENT_ACTION, {
    input: [{
      command,
      cwd: env.cwd,
      generation_id: env.generation_id,
      event_category: 'agent_action',
    }],
  });
  if (verdict.arm === 'halt') markHalted(env.conversation_id, cfg);
  return verdict;
}
