import type {
  CursorSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { CursorEnvelope } from '../../../core-client/generated/runtime/cursor.js';
import {
  buildSubagentStartPayload,
  SUBAGENT_START_ACTIVITY_TYPE,
} from '../../../core-client/generated/runtime/cursor.js';
import type { CursorConfig } from '../config.js';
import { markHalted } from '../session-resolver.js';
import { EVENT } from '../activity-types.js';

/**
 * subagentStart: govern delegation to a subagent. This is the only
 * Cursor hook with a hardcoded chat-side wrapper string ("Subagent
 * creation blocked by hook: <user_message>"), so a deny verdict
 * produces user-visible attribution to OpenBox automatically.
 */
export async function handleSubagentStart(
  env: CursorEnvelope,
  session: CursorSession,
  cfg: CursorConfig,
): Promise<WorkflowVerdict | undefined> {
  const payload = buildSubagentStartPayload(env);
  const verdict = await session.activity(
    EVENT.START,
    SUBAGENT_START_ACTIVITY_TYPE,
    { input: [payload] },
  );
  if (verdict.arm === 'halt') markHalted(env.conversation_id, cfg);
  return verdict;
}
