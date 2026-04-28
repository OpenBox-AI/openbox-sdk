import type {
  ClaudeCodeSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { ClaudeCodeEnvelope } from '../../../core-client/generated/runtime/claude-code.js';
import {
  PERMISSION_REQUEST_ROUTING,
  buildPermissionRequestPayload,
} from '../../../core-client/generated/runtime/claude-code.js';
import type { ClaudeCodeConfig } from '../config.js';
import { markHalted } from '../session-resolver.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';

function activityTypeForTool(toolName: string): string {
  const direct = PERMISSION_REQUEST_ROUTING[toolName];
  if (direct) return direct;
  if (toolName.startsWith('mcp__')) return ACTIVITY_TYPES.MCP_CALL;
  // Unknown tool - govern as a generic shell-like action so something
  // still hits the wire (better than dropping the request silently).
  return ACTIVITY_TYPES.SHELL;
}

/**
 * PermissionRequest fires when Claude Code asks the user whether to allow
 * a tool call. Same payload + same activity type as PreToolUse so the
 * same guardrails / policies / behavior rules see identical input.
 */
export async function handlePermissionRequest(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeCodeConfig,
): Promise<WorkflowVerdict | undefined> {
  const toolName = env.tool_name ?? '';
  if (cfg.skipTools.includes(toolName)) return undefined;

  const activityType = activityTypeForTool(toolName);
  const payload = buildPermissionRequestPayload(env, toolName);
  const verdict = await session.activity(EVENT.START, activityType, { input: [payload] });
  if (verdict.arm === 'halt') markHalted(env.session_id, cfg);
  return verdict;
}
