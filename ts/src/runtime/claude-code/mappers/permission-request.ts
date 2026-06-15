import type {
  ClaudeCodeSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { ClaudeCodeEnvelope } from '../../../core-client/generated/runtime/claude-code.js';
import {
  buildPermissionDeniedPayload,
  PERMISSION_REQUEST_ROUTING,
  buildPermissionRequestPayload,
} from '../../../core-client/generated/runtime/claude-code.js';
import type { ClaudeCodeConfig } from '../config.js';
import { markHalted } from '../session-resolver.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';
import { buildSpan, type SpanType } from '../../../governance/spans.js';
import { stampSource } from '../../../approvals/source.js';

function activityTypeForTool(toolName: string): string {
  const direct = PERMISSION_REQUEST_ROUTING[toolName];
  if (direct) return direct;
  if (toolName.startsWith('mcp__')) return ACTIVITY_TYPES.MCP_CALL;
  return ACTIVITY_TYPES.AGENT_ACTION;
}

function spanTypeFor(toolName: string): SpanType | null {
  if (toolName === 'Read' || toolName === 'NotebookRead' || toolName === 'Glob' || toolName === 'Grep') return 'file_read';
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'NotebookEdit') return 'file_write';
  if (toolName === 'Delete') return 'file_delete';
  if (toolName === 'Bash' || toolName === 'PowerShell') return 'shell';
  if (toolName === 'WebFetch' || toolName === 'WebSearch') return 'http';
  if (toolName.startsWith('mcp__')) return 'mcp';
  return null;
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
  if ((cfg.skipTools ?? []).includes(toolName)) return undefined;

  const activityType = activityTypeForTool(toolName);
  if ((cfg.skipActivityTypes ?? []).includes(activityType)) return undefined;
  const toolInput = (env.tool_input ?? {}) as Record<string, unknown>;
  const payload = buildPermissionRequestPayload(env, toolName);
  const spanType = spanTypeFor(toolName);
  const spans = spanType
    ? [
        buildSpan('claude-code', spanType, {
          file_path: (toolInput.file_path ?? toolInput.filePath ?? toolInput.path ?? toolInput.notebook_path) as string | undefined,
          command: toolInput.command as string | undefined,
          cwd: toolInput.cwd as string | undefined,
          tool_name: toolName,
          tool_input: toolInput,
          url: (toolInput.url as string) || (toolInput.query as string) || undefined,
          method: 'GET',
        }),
      ]
    : undefined;
  const verdict = await session.activity(EVENT.START, activityType, {
    input: [stampSource(payload, 'claude-code')],
    spans,
  });
  if (verdict.arm === 'halt') markHalted(env.session_id, cfg);
  return verdict;
}

export async function handlePermissionDenied(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeCodeConfig,
): Promise<WorkflowVerdict | undefined> {
  const toolName = env.tool_name ?? '';
  const activityType = activityTypeForTool(toolName);
  if ((cfg.skipActivityTypes ?? []).includes(activityType)) return undefined;
  const payload = buildPermissionDeniedPayload(env);
  const verdict = await session.activity(EVENT.START, activityType, {
    input: [stampSource(payload, 'claude-code')],
  });
  if (verdict.arm === 'halt') markHalted(env.session_id, cfg);
  return verdict;
}
