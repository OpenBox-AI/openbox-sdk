import * as fs from 'node:fs';
import type {
  ClaudeCodeSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { ClaudeCodeEnvelope } from '../../../core-client/generated/runtime/claude-code.js';
// Spec-driven tool→activity_type table; declared via @activityRouting on
// the PreToolUse op in specs/typespec/govern/adapters.tsp.
import { PRE_TOOL_USE_ROUTING } from '../../../core-client/generated/runtime/claude-code.js';
import type { ClaudeCodeConfig } from '../config.js';
import { markHalted } from '../session-resolver.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';
import { isSkipped } from '../../_shared/skip-patterns.js';

/**
 * Lookup the activity_type for a Claude Code tool name. Spec-driven for
 * the standard tools (PRE_TOOL_USE_ROUTING from @activityRouting); a
 * single runtime fallback handles mcp__* tools because their names are
 * dynamic (`mcp__<server>__<tool>`) and don't fit a static table.
 */
function activityTypeFor(toolName: string): string | null {
  const direct = PRE_TOOL_USE_ROUTING[toolName];
  if (direct) return direct;
  if (toolName.startsWith('mcp__')) return ACTIVITY_TYPES.MCP_CALL;
  return null;
}

/**
 * PreToolUse: agent is about to call a tool. Activity-type routing
 * (Read → FileRead, Bash → ShellExecution, etc.) comes from the spec
 * via PRE_TOOL_USE_ROUTING; per-tool payload shaping lives below.
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

  const fire = async (input: Record<string, unknown>) => {
    const v = await session.activity(EVENT.START, activityType, { input: [input] });
    if (v.arm === 'halt') markHalted(env.session_id, cfg);
    return v;
  };

  // Per-tool payload shaping. Each branch knows what fields to pull
  // from `tool_input` and which need disk I/O (Read for PII scanning).
  // Tool name → activity_type lookup is already done; this switch is
  // purely about the SHAPE of `input` we send for evaluation.
  switch (toolName) {
    case 'Read': {
      const filePath = (toolInput.file_path ?? toolInput.filePath ?? '') as string;
      if (!filePath) return undefined;
      if (isSkipped(filePath)) return undefined;
      let content = '';
      try {
        if (fs.existsSync(filePath)) content = fs.readFileSync(filePath, 'utf-8');
      } catch { /* skip content; still govern the path */ }
      return fire({ text: content, file_path: filePath, content, event_category: 'file_read' });
    }

    case 'Delete': {
      const filePath = (toolInput.path ?? toolInput.file_path ?? '') as string;
      if (!filePath) return undefined;
      if (isSkipped(filePath)) return undefined;
      return fire({ text: filePath, file_path: filePath, event_category: 'file_delete' });
    }

    case 'Write':
    case 'Edit': {
      const filePath = (toolInput.file_path ?? toolInput.filePath ?? '') as string;
      if (filePath && isSkipped(filePath)) return undefined;
      const content = (toolInput.content ?? toolInput.new_string ?? '') as string;
      return fire({ text: content, file_path: filePath, content, event_category: 'file_write' });
    }

    case 'Bash': {
      const command = (toolInput.command ?? '') as string;
      const cwd = (toolInput.cwd ?? env.cwd ?? '') as string;
      return fire({ text: command, command, cwd, event_category: 'agent_action' });
    }

    case 'WebFetch':
    case 'WebSearch': {
      const url = (toolInput.url ?? toolInput.query ?? '') as string;
      return fire({ url, http_method: 'GET', event_category: 'http_request' });
    }

    case 'Agent': {
      const agentType = (toolInput.subagent_type ?? toolInput.description ?? '') as string;
      return fire({
        agent_type: agentType,
        prompt: (toolInput.prompt ?? '') as string,
        event_category: 'agent_action',
      });
    }

    default: {
      // Spec-driven activity type already says MCP_CALL via the mcp__* fallback above.
      const parts = toolName.split('__');
      const serverName = parts[1] || 'unknown';
      const mcpToolName = parts.slice(2).join('__') || 'unknown';
      return fire({
        tool_name: mcpToolName,
        server_name: serverName,
        tool_input: toolInput,
        event_category: 'mcp_tool_call',
      });
    }
  }
}
