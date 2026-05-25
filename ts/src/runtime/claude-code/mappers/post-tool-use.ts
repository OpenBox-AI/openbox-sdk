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
import { buildSpan, type SpanType } from '../../../governance/spans.js';
import { stampSource } from '../../../approvals/source.js';
import { sideEffects } from '../side-effects.js';

function activityTypeFor(toolName: string): string | null {
  const direct = POST_TOOL_USE_ROUTING[toolName];
  if (direct) return direct;
  if (toolName.startsWith('mcp__')) return ACTIVITY_TYPES.MCP_CALL;
  return null;
}

function spanTypeFor(toolName: string): SpanType | null {
  if (toolName === 'Read') return 'file_read';
  if (toolName === 'Write' || toolName === 'Edit') return 'file_write';
  if (toolName === 'Delete') return 'file_delete';
  if (toolName === 'Bash') return 'shell';
  if (toolName === 'WebFetch' || toolName === 'WebSearch') return 'http';
  if (toolName.startsWith('mcp__')) return 'mcp';
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

  const toolInput = (env.tool_input ?? {}) as Record<string, unknown>;
  const toolResponse = (env as { tool_response?: unknown }).tool_response;
  const payload = buildPostToolUsePayload(env, sideEffects);
  const spanType = spanTypeFor(toolName);
  const spans = spanType
    ? [
        buildSpan('claude-code', spanType, {
          file_path: (toolInput.file_path ?? toolInput.filePath ?? toolInput.path) as string | undefined,
          command: toolInput.command as string | undefined,
          cwd: toolInput.cwd as string | undefined,
          tool_name: toolName,
          tool_output: toolResponse,
          url: (toolInput.url as string) || (toolInput.query as string) || undefined,
          method: 'GET',
        }),
      ]
    : undefined;
  const verdict = await session.activity(EVENT.COMPLETE, activityType, {
    input: [stampSource(payload, 'claude-code')],
    spans,
  });
  if (verdict.arm === 'halt') markHalted(env.session_id, cfg);
  return verdict;
}
