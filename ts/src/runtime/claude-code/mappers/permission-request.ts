import type {
  ClaudeCodeSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { ClaudeCodeEnvelope } from '../../../core-client/generated/runtime/claude-code.js';
// Spec-driven tool→activity_type table, declared via @activityRouting.
import { PERMISSION_REQUEST_ROUTING } from '../../../core-client/generated/runtime/claude-code.js';
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

function eventCategoryForTool(toolName: string): string {
  switch (toolName) {
    case 'Read':      return 'file_read';
    case 'Delete':    return 'file_delete';
    case 'Write':
    case 'Edit':      return 'file_write';
    case 'Bash':      return 'agent_action';
    case 'WebFetch':
    case 'WebSearch': return 'http_request';
    case 'Agent':     return 'agent_action';
    default:
      if (toolName.startsWith('mcp__')) return 'mcp_tool_call';
      return 'agent_action';
  }
}

/**
 * PermissionRequest fires when Claude Code asks the user whether to allow
 * a tool call. We govern the same payload PreToolUse would, so the same
 * guardrails / policies / behavior rules see identical input.
 *
 * Verdict shape on output: `permission-request` - adapter writes
 *   {hookSpecificOutput:{hookEventName:'PermissionRequest', decision:{behavior:'allow'|'deny',message?}}}
 */
export async function handlePermissionRequest(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeCodeConfig,
): Promise<WorkflowVerdict | undefined> {
  const toolName = env.tool_name ?? '';
  const toolInput = (env.tool_input ?? {}) as Record<string, unknown>;
  if (cfg.skipTools.includes(toolName)) return undefined;

  const activityType = activityTypeForTool(toolName);
  const payload: Record<string, unknown> = {
    tool_name: toolName,
    tool_input: toolInput,
    event_category: eventCategoryForTool(toolName),
  };
  // Mirror PreToolUse field shaping so guardrail field_paths resolve identically.
  if (toolName === 'Bash') {
    payload.text = toolInput.command ?? '';
    payload.command = toolInput.command ?? '';
    payload.cwd = toolInput.cwd ?? env.cwd ?? '';
  } else if (toolName === 'Write' || toolName === 'Edit') {
    const filePath = toolInput.file_path ?? toolInput.filePath ?? '';
    const content = toolInput.content ?? toolInput.new_string ?? '';
    payload.text = content;
    payload.file_path = filePath;
    payload.content = content;
  } else if (toolName === 'Read') {
    payload.file_path = toolInput.file_path ?? toolInput.filePath ?? '';
  } else if (toolName === 'Delete') {
    payload.file_path = toolInput.path ?? toolInput.file_path ?? '';
  } else if (toolName === 'WebFetch' || toolName === 'WebSearch') {
    payload.url = toolInput.url ?? toolInput.query ?? '';
    payload.http_method = 'GET';
  }

  const verdict = await session.activity(EVENT.START, activityType, { input: [payload] });
  if (verdict.arm === 'halt') markHalted(env.session_id, cfg);
  return verdict;
}
