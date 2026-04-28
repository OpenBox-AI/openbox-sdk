import type {
  ClaudeCodeSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { ClaudeHookEnvelope } from '../../../core-client/generated/runtime/claude-hooks.js';
// Spec-driven tool→activity_type table, declared via @activityRouting.
import { POST_TOOL_USE_ROUTING } from '../../../core-client/generated/runtime/claude-hooks.js';
import type { ClaudeHooksConfig } from '../config.js';
import { markHalted } from '../session-resolver.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';

function activityTypeFor(toolName: string): string | null {
  const direct = POST_TOOL_USE_ROUTING[toolName];
  if (direct) return direct;
  if (toolName.startsWith('mcp__')) return ACTIVITY_TYPES.MCP_CALL;
  return null;
}

/**
 * PostToolUse fires after the tool returned. Single ActivityCompleted
 * closes the activity opened by PreToolUse and runs output governance
 * (PII detection on the tool's response, etc). Verdict shape:
 * decision-block - adapter writes `{decision:'block', reason}` only on
 * block/halt; otherwise empty stdout = "no opinion, continue".
 */
export async function handlePostToolUse(
  env: ClaudeHookEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeHooksConfig,
): Promise<WorkflowVerdict | undefined> {
  const toolName = env.tool_name ?? '';
  const activityType = activityTypeFor(toolName);
  if (!activityType) return undefined;

  const toolOutput = env.tool_output;
  const outputStr = typeof toolOutput === 'string'
    ? toolOutput
    : JSON.stringify(toolOutput ?? {});
  const truncated = outputStr.length > 5000 ? outputStr.slice(0, 5000) : outputStr;

  const verdict = await session.activity(EVENT.COMPLETE, activityType, {
    input: [{
      tool_name: toolName,
      output: truncated,
      event_category: 'agent_observation',
    }],
  });
  if (verdict.arm === 'halt') markHalted(env.session_id, cfg);
  return verdict;
}
