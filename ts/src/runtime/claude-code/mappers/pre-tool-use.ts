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
import { buildSpan, type SpanType } from '../../../governance/spans.js';
import { stampSource } from '../../../approvals/source.js';
import { sideEffects } from '../side-effects.js';
import { rememberToolActivity } from '../tool-activity-store.js';
import {
  dbOperationFor,
  dbStatementFor,
  dbSystemFor,
  filePathFor,
  httpMethodFor,
  httpTargetFor,
  isDatabaseMcpTool,
} from './tool-input.js';

/** Activity-type lookup. Spec-driven for the standard tools; mcp__* tools
 *  fall through to MCP_CALL because their names are dynamic. */
function activityTypeFor(toolName: string, toolInput: Record<string, unknown>): string | null {
  const direct = PRE_TOOL_USE_ROUTING[toolName];
  if (direct) return direct;
  if (isDatabaseMcpTool(toolName, toolInput)) return ACTIVITY_TYPES.DB_QUERY;
  if (toolName.startsWith('mcp__')) return ACTIVITY_TYPES.MCP_CALL;
  return ACTIVITY_TYPES.AGENT_ACTION;
}

/** Map a tool name to the span type behavior rules will match on.
 *  Returns null for tools without a recognized span shape (the span
 *  is omitted; rules that need spans silently won't match). */
function spanTypeFor(toolName: string, toolInput: Record<string, unknown>): SpanType | null {
  if (toolName === 'Read' || toolName === 'NotebookRead' || toolName === 'Glob' || toolName === 'Grep') return 'file_read';
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'NotebookEdit') return 'file_write';
  if (toolName === 'Delete') return 'file_delete';
  if (toolName === 'Bash' || toolName === 'PowerShell') return 'shell';
  if (toolName === 'WebFetch' || toolName === 'WebSearch') return 'http';
  if (isDatabaseMcpTool(toolName, toolInput)) return 'db';
  if (toolName.startsWith('mcp__')) return 'mcp';
  return null;
}

/**
 * PreToolUse: agent is about to call a tool. Activity routing comes from
 * @activityRouting; payload field shape comes from @payloadShape; both
 * generated. This file is just the platform shell: span build, fire,
 * halt-mark on halt verdict.
 */
export async function handlePreToolUse(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeCodeConfig,
): Promise<WorkflowVerdict | undefined> {
  const toolName = env.tool_name ?? '';
  const toolInput = (env.tool_input ?? {}) as Record<string, unknown>;

  const activityType = activityTypeFor(toolName, toolInput);
  if (!activityType) return undefined;
  const filePath = filePathFor(toolInput) ?? '';

  const payload = buildPreToolUsePayload(env, toolName, sideEffects);

  // Build a span so behavior rules can match; see
  // governance/spans.ts. Without spans, every rule silently
  // no-ops (Activity type alone is not a behavior trigger; see
  // skill/references/span-reference.md).
  const spanType = spanTypeFor(toolName, toolInput);
  const effectiveSpanType = spanType ?? (activityType === ACTIVITY_TYPES.DB_QUERY ? 'db' : null);
  const spans = effectiveSpanType
    ? [
        buildSpan('claude-code', effectiveSpanType, {
          file_path: filePath || undefined,
          command: (toolInput.command as string) || undefined,
          cwd: (toolInput.cwd as string) || undefined,
          tool_name: toolName,
          tool_input: toolInput,
          url: httpTargetFor(toolInput),
          method: httpMethodFor(toolInput),
          db_system: dbSystemFor(toolName, toolInput),
          db_operation: dbOperationFor(toolInput),
          db_statement: dbStatementFor(toolInput),
        }),
      ]
    : undefined;

  const startTime = Date.now();
  const opened = await session.openActivity(activityType, {
    input: [stampSource(payload, 'claude-code')],
    sessionId: env.session_id,
    toolName,
    toolType: effectiveSpanType ?? undefined,
    startTime,
    spans,
  });
  const verdict = opened.verdict;
  if (
    verdict.arm === 'allow' ||
    verdict.arm === 'constrain' ||
    verdict.arm === 'require_approval'
  ) {
    rememberToolActivity(env, cfg, {
      activityId: opened.activityId,
      activityType,
      startTime,
    });
  }
  if (verdict.arm === 'halt') markHalted(env.session_id, cfg);
  return verdict;
}
