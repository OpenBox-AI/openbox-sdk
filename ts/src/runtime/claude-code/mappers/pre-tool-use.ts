import * as fs from 'node:fs';
import type {
  ClaudeCodeSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { ClaudeHookEnvelope } from '../../../core-client/generated/runtime/claude-hooks.js';
import type { ClaudeHooksConfig } from '../config.js';
import { markHalted } from '../session-resolver.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';

/** Paths that should never be governed (IDE internals, skills, config dirs).
 *  Claude Code reads .claude/ metadata, skills, etc. before the user's actual
 *  file; PII scanning those causes false HALTs. */
const SKIP_PATTERNS = [
  /\.cursor\//,
  /\.claude\//,
  /\/mcps\//,
  /\/node_modules\//,
  /\.git\//,
  /INSTRUCTIONS\.md$/,
  /SERVER_METADATA\.json$/,
  /SKILL\.md$/,
  /\.env(\..*)?$/,
  /\.aws\//,
  /\.ssh\//,
  /\.kube\//,
  /\.gnupg\//,
];

function tagHaltIfNeeded(env: ClaudeHookEnvelope, verdict: WorkflowVerdict, cfg: ClaudeHooksConfig): void {
  if (verdict.arm === 'halt') markHalted(env.session_id, cfg);
}

/**
 * PreToolUse: agent is about to call a tool. Claude Code fires one hook
 * per tool call regardless of tool - we route to the appropriate
 * activity_type so per-tool guardrails / policies match.
 *
 *   Read       → FileRead  (with on-disk content, for PII scan)
 *   Write/Edit → FileEdit
 *   Delete     → FileDelete
 *   Bash       → ShellExecution
 *   WebFetch   → HTTPRequest
 *   WebSearch  → HTTPRequest
 *   Agent      → AgentSpawn
 *   mcp__*     → MCPToolCall
 *   Glob/Grep  → skipped (configurable; read-only search)
 */
export async function handlePreToolUse(
  env: ClaudeHookEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeHooksConfig,
): Promise<WorkflowVerdict | undefined> {
  const toolName = env.tool_name ?? '';
  const toolInput = (env.tool_input ?? {}) as Record<string, unknown>;

  if (cfg.skipTools.includes(toolName)) return undefined;

  const fire = async (activityType: string, input: Record<string, unknown>) => {
    const v = await session.activity(EVENT.START, activityType, { input: [input] });
    tagHaltIfNeeded(env, v, cfg);
    return v;
  };

  switch (toolName) {
    case 'Read': {
      const filePath = (toolInput.file_path ?? toolInput.filePath ?? '') as string;
      if (!filePath) return undefined;
      if (SKIP_PATTERNS.some((p) => p.test(filePath))) return undefined;

      let content = '';
      try {
        if (fs.existsSync(filePath)) content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        // Can't read file - skip content scanning, still govern the path
      }

      return fire(ACTIVITY_TYPES.FILE_READ, {
        text: content,
        file_path: filePath,
        content,
        event_category: 'file_read',
      });
    }

    case 'Delete': {
      const filePath = (toolInput.path ?? toolInput.file_path ?? '') as string;
      if (!filePath) return undefined;
      if (SKIP_PATTERNS.some((p) => p.test(filePath))) return undefined;
      return fire(ACTIVITY_TYPES.FILE_DELETE, {
        text: filePath,
        file_path: filePath,
        event_category: 'file_delete',
      });
    }

    case 'Write':
    case 'Edit': {
      const filePath = (toolInput.file_path ?? toolInput.filePath ?? '') as string;
      if (filePath && SKIP_PATTERNS.some((p) => p.test(filePath))) return undefined;
      const content = (toolInput.content ?? toolInput.new_string ?? '') as string;
      return fire(ACTIVITY_TYPES.FILE_EDIT, {
        text: content,
        file_path: filePath,
        content,
        event_category: 'file_write',
      });
    }

    case 'Bash': {
      const command = (toolInput.command ?? '') as string;
      const cwd = (toolInput.cwd ?? env.cwd ?? '') as string;
      return fire(ACTIVITY_TYPES.SHELL, {
        text: command,
        command,
        cwd,
        event_category: 'agent_action',
      });
    }

    case 'WebFetch':
    case 'WebSearch': {
      const url = (toolInput.url ?? toolInput.query ?? '') as string;
      return fire(ACTIVITY_TYPES.HTTP_REQUEST, {
        url,
        http_method: 'GET',
        event_category: 'http_request',
      });
    }

    case 'Agent': {
      const agentType = (toolInput.subagent_type ?? toolInput.description ?? '') as string;
      return fire(ACTIVITY_TYPES.AGENT_SPAWN, {
        agent_type: agentType,
        prompt: (toolInput.prompt ?? '') as string,
        event_category: 'agent_action',
      });
    }

    default: {
      if (toolName.startsWith('mcp__')) {
        const parts = toolName.split('__');
        const serverName = parts[1] || 'unknown';
        const mcpToolName = parts.slice(2).join('__') || 'unknown';
        return fire(ACTIVITY_TYPES.MCP_CALL, {
          tool_name: mcpToolName,
          server_name: serverName,
          tool_input: toolInput,
          event_category: 'mcp_tool_call',
        });
      }
      // Unknown tool - allow by default
      return undefined;
    }
  }
}
