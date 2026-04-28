import type {
  ClaudeCodeSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { ClaudeCodeEnvelope } from '../../../core-client/generated/runtime/claude-code.js';
import {
  PRE_TOOL_USE_ROUTING,
  buildPreToolUsePayload,
} from '../../../core-client/generated/runtime/claude-code.js';
import type { ClaudeCodeConfig } from '../config.js';
import { markHalted } from '../session-resolver.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';
import { isSkipped } from '../../_shared/skip-patterns.js';
import { sideEffects } from '../side-effects.js';

/** Activity-type lookup. Spec-driven for the standard tools; mcp__* tools
 *  fall through to MCP_CALL because their names are dynamic. */
function activityTypeFor(toolName: string): string | null {
  const direct = PRE_TOOL_USE_ROUTING[toolName];
  if (direct) return direct;
  if (toolName.startsWith('mcp__')) return ACTIVITY_TYPES.MCP_CALL;
  return null;
}

/**
 * PreToolUse: agent is about to call a tool. Activity routing comes from
 * @activityRouting; payload field shape comes from @payloadShape - both
 * generated. This file is just the platform shell: skip-pattern check,
 * fire, halt-mark on halt verdict.
 */
export async function handlePreToolUse(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeCodeConfig,
): Promise<WorkflowVerdict | undefined> {
  const toolName = env.tool_name ?? '';
  const toolInput = (env.tool_input ?? {}) as Record<string, unknown>;
  if (cfg.skipTools.includes(toolName)) return undefined;

  const activityType = activityTypeFor(toolName);
  if (!activityType) return undefined;

  // Skip-pattern guard for the file-touching tools - paths inside
  // SKIP_PATTERNS (.claude/, .git/, .ssh/, etc.) bypass governance to
  // avoid PII false-HALTs on IDE metadata.
  const filePath = (toolInput.file_path ?? toolInput.filePath ?? toolInput.path ?? '') as string;
  if (filePath && isSkipped(filePath)) return undefined;

  const payload = buildPreToolUsePayload(env, toolName, sideEffects);
  const verdict = await session.activity(EVENT.START, activityType, { input: [payload] });
  if (verdict.arm === 'halt') markHalted(env.session_id, cfg);
  return verdict;
}
