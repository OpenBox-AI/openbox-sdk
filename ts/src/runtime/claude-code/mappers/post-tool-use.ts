import type {
  ClaudeCodeSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { ClaudeHookEnvelope } from '../../../core-client/generated/runtime/claude-hooks.js';
import type { ClaudeHooksConfig } from '../config.js';
import { markHalted } from '../session-resolver.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';

function toolToActivityType(toolName: string): string | null {
  switch (toolName) {
    case 'Bash':      return ACTIVITY_TYPES.SHELL;
    case 'Read':      return ACTIVITY_TYPES.FILE_READ;
    case 'Delete':    return ACTIVITY_TYPES.FILE_DELETE;
    case 'Write':
    case 'Edit':      return ACTIVITY_TYPES.FILE_EDIT;
    case 'WebFetch':
    case 'WebSearch': return ACTIVITY_TYPES.HTTP_REQUEST;
    case 'Agent':     return ACTIVITY_TYPES.AGENT_SPAWN;
    default:
      if (toolName.startsWith('mcp__')) return ACTIVITY_TYPES.MCP_CALL;
      return null;
  }
}

/**
 * PostToolUse fires after the tool returned. Single ActivityCompleted
 * closes the activity opened by PreToolUse and runs output governance
 * (PII detection on the tool's response, etc).
 *
 * Spec verdict shape is `decision-block` - the adapter writes
 * {decision:"block", reason} only on block/halt; otherwise empty stdout
 * (Claude Code interprets that as "no opinion, continue").
 */
export async function handlePostToolUse(
  env: ClaudeHookEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeHooksConfig,
): Promise<WorkflowVerdict | undefined> {
  const toolName = env.tool_name ?? '';
  const activityType = toolToActivityType(toolName);
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
