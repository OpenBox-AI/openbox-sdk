import type {
  ClaudeCodeSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { ClaudeCodeEnvelope } from '../../../core-client/generated/runtime/claude-code.js';
import {
  POST_TOOL_USE_ROUTING,
  buildPostToolUsePayload,
} from '../../../core-client/generated/runtime/claude-code.js';
import type { ClaudeCodeConfig } from '../config.js';
import { markHalted } from '../session-resolver.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';
import { sideEffects } from '../side-effects.js';

function activityTypeFor(toolName: string): string | null {
  const direct = POST_TOOL_USE_ROUTING[toolName];
  if (direct) return direct;
  if (toolName.startsWith('mcp__')) return ACTIVITY_TYPES.MCP_CALL;
  return null;
}

/**
 * PostToolUse fires after the tool returned. Closes the activity opened
 * by PreToolUse and runs output governance. Verdict shape is
 * decision-block; empty stdout = "no opinion, continue".
 */
export async function handlePostToolUse(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeCodeConfig,
): Promise<WorkflowVerdict | undefined> {
  const toolName = env.tool_name ?? '';
  const activityType = activityTypeFor(toolName);
  if (!activityType) return undefined;

  const payload = buildPostToolUsePayload(env, sideEffects);
  const verdict = await session.activity(EVENT.COMPLETE, activityType, { input: [payload] });
  if (verdict.arm === 'halt') markHalted(env.session_id, cfg);
  return verdict;
}
