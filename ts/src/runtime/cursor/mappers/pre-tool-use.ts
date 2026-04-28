import type {
  CursorSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { CursorEnvelope } from '../../../core-client/generated/runtime/cursor.js';
import {
  PRE_TOOL_USE_ROUTING,
  PRE_TOOL_USE_VARIANTS,
  applyActivityVariant,
  buildPreToolUsePayload,
} from '../../../core-client/generated/runtime/cursor.js';
import type { CursorConfig } from '../config.js';
import { markHalted } from '../session-resolver.js';
import { EVENT } from '../activity-types.js';
import { isSkipped } from '../../_shared/skip-patterns.js';
import { sideEffects } from '../side-effects.js';

/**
 * preToolUse: Cursor 3.x's primary agent-action hook. Activity routing,
 * payload shape, AND the Shell→file_delete predicate reroute all come
 * from spec (@activityRouting + @payloadShape + @activityVariant on
 * adapters.tsp). This file is pure platform shell.
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

  const payload = buildPreToolUsePayload(env, toolName, sideEffects);
  const override = applyActivityVariant(PRE_TOOL_USE_VARIANTS, toolName, env);
  const activityType = override?.activityType ?? baseActivity;
  if (override?.eventCategory) payload.event_category = override.eventCategory;

  const verdict = await session.activity(EVENT.START, activityType, { input: [payload] });
  if (verdict.arm === 'halt') markHalted(env.conversation_id, cfg);
  return verdict;
}
