import type {
  CursorSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { CursorEnvelope } from '../../../core-client/generated/runtime/cursor.js';
import {
  PRE_TOOL_USE_ROUTING,
  buildPreToolUsePayload,
} from '../../../core-client/generated/runtime/cursor.js';
import type { CursorConfig } from '../config.js';
import { markHalted } from '../session-resolver.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';
import { isSkipped } from '../../_shared/skip-patterns.js';
import { sideEffects } from '../side-effects.js';

/**
 * preToolUse: Cursor 3.x's primary agent-action hook. Activity routing
 * + payload shape come from spec (@activityRouting + @payloadShape on
 * adapters.tsp). Cursor's Shell tool is reused for file deletes via
 * `rm`/`unlink`/`rmdir`/`shred` - the activity_type is rerouted to
 * file_write here so existing file-write guardrails / policies match.
 * (Pure runtime predicate; no @payloadVariant in H.1.)
 */
export async function handlePreToolUse(
  env: CursorEnvelope,
  session: CursorSession,
  cfg: CursorConfig,
): Promise<WorkflowVerdict | undefined> {
  const toolName = env.tool_name ?? '';
  const baseActivity = PRE_TOOL_USE_ROUTING[toolName];
  if (!baseActivity) return undefined;

  const toolInput = (env.tool_input ?? {}) as Record<string, unknown>;
  const filePath = (toolInput.file_path ?? toolInput.filePath ?? '') as string;
  if (filePath && isSkipped(filePath)) return undefined;

  let activityType = baseActivity;
  if (toolName === 'Shell') {
    const command = (toolInput.command ?? '') as string;
    if (/\b(rm|unlink|rmdir|shred)\b/.test(command)) {
      activityType = ACTIVITY_TYPES.FILE_WRITE;
    }
  }

  const payload = buildPreToolUsePayload(env, toolName, sideEffects);
  // Shell→delete rerouting also bumps event_category for downstream rules.
  if (activityType === ACTIVITY_TYPES.FILE_WRITE && toolName === 'Shell') {
    payload.event_category = 'file_delete';
  }

  const verdict = await session.activity(EVENT.START, activityType, { input: [payload] });
  if (verdict.arm === 'halt') markHalted(env.conversation_id, cfg);
  return verdict;
}
