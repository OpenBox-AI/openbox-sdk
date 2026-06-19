import type {
  ClaudeCodeSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { ClaudeCodeEnvelope } from '../../../core-client/generated/runtime/claude-code.js';
import {
  POST_TOOL_USE_ROUTING,
  buildPreToolUsePayload,
  buildPostToolBatchPayload,
  buildPostToolUseFailurePayload,
  buildPostToolUsePayload,
} from '../../../core-client/generated/runtime/claude-code.js';
import type { ClaudeCodeConfig } from '../config.js';
import { markHalted } from '../session-resolver.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';
import {
  buildSpan,
  withOpenBoxActivityMetadata,
  type SpanType,
} from '../../../governance/spans.js';
import { stampSource } from '../../../approvals/source.js';
import { sideEffects } from '../side-effects.js';
import { takeToolActivity } from '../tool-activity-store.js';
import {
  dbOperationFor,
  dbStatementFor,
  dbSystemFor,
  filePathFor,
  httpMethodFor,
  httpTargetFor,
  isDatabaseMcpTool,
} from './tool-input.js';

function activityTypeFor(toolName: string, toolInput: Record<string, unknown>): string {
  const direct = POST_TOOL_USE_ROUTING[toolName];
  if (direct) return direct;
  if (isDatabaseMcpTool(toolName, toolInput)) return ACTIVITY_TYPES.DB_QUERY;
  if (toolName.startsWith('mcp__')) return ACTIVITY_TYPES.MCP_CALL;
  return ACTIVITY_TYPES.AGENT_ACTION;
}

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

function durationMsFor(env: ClaudeCodeEnvelope): number | undefined {
  const durationMs = env.duration_ms;
  return typeof durationMs === 'number' && Number.isFinite(durationMs)
    ? durationMs
    : undefined;
}

function outputFor(env: ClaudeCodeEnvelope, payload: Record<string, unknown>): unknown {
  return env.tool_response ?? env.tool_output ?? payload.output;
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function failureError(env: ClaudeCodeEnvelope, payload: Record<string, unknown>): unknown {
  return (
    stringFrom(env.error) ??
    stringFrom(env.reason) ??
    stringFrom((env as { error_message?: unknown }).error_message) ??
    payload
  );
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
  const toolInput = (env.tool_input ?? {}) as Record<string, unknown>;

  const activityType = activityTypeFor(toolName, toolInput);

  const filePath = filePathFor(toolInput) ?? '';

  const pending = takeToolActivity(env, cfg);
  const toolResponse = outputFor(env, {});
  const payload = buildPostToolUsePayload(env, sideEffects);
  const startedPayload = buildPreToolUsePayload(env, toolName, sideEffects);
  const spanType = spanTypeFor(toolName, toolInput);
  const effectiveSpanType = spanType ?? (activityType === ACTIVITY_TYPES.DB_QUERY ? 'db' : null);
  const spans = effectiveSpanType
    ? [
        buildSpan('claude-code', effectiveSpanType, {
          stage: 'completed',
          file_path: (toolInput.file_path ?? toolInput.filePath ?? toolInput.path ?? toolInput.notebook_path) as string | undefined,
          command: toolInput.command as string | undefined,
          cwd: toolInput.cwd as string | undefined,
          tool_name: toolName,
          tool_output: toolResponse,
          url: httpTargetFor(toolInput),
          method: httpMethodFor(toolInput),
          db_system: dbSystemFor(toolName, toolInput),
          db_operation: dbOperationFor(toolInput),
          db_statement: dbStatementFor(toolInput),
        }),
      ]
    : undefined;
  const durationMs = durationMsFor(env);
  const verdict = await session.activity(EVENT.COMPLETE, activityType, {
    activityId: pending?.activityId,
    startTime: pending?.startTime,
    endTime: pending && durationMs !== undefined ? pending.startTime + durationMs : undefined,
    durationMs,
    input: withOpenBoxActivityMetadata(
      [stampSource(startedPayload, 'claude-code')],
      { toolType: effectiveSpanType },
    ),
    output: outputFor(env, payload),
    sessionId: env.session_id,
    toolName,
    toolType: effectiveSpanType ?? undefined,
    spans,
    hookSpanParentEventType: spans ? 'ActivityStarted' : undefined,
  });
  if (verdict.arm === 'halt') markHalted(env.session_id, cfg);
  return verdict;
}

export async function handlePostToolUseFailure(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeCodeConfig,
): Promise<WorkflowVerdict | undefined> {
  const toolName = env.tool_name ?? '';
  const toolInput = (env.tool_input ?? {}) as Record<string, unknown>;

  const activityType = activityTypeFor(toolName, toolInput);
  const filePath = filePathFor(toolInput) ?? '';

  const pending = takeToolActivity(env, cfg);
  const payload = buildPostToolUseFailurePayload(env);
  const startedPayload = buildPreToolUsePayload(env, toolName, sideEffects);
  const spanType = spanTypeFor(toolName, toolInput);
  const effectiveSpanType = spanType ?? (activityType === ACTIVITY_TYPES.DB_QUERY ? 'db' : null);
  const spans = effectiveSpanType
    ? [
        buildSpan('claude-code', effectiveSpanType, {
          stage: 'completed',
          file_path: filePath || undefined,
          command: toolInput.command as string | undefined,
          cwd: toolInput.cwd as string | undefined,
          tool_name: toolName,
          tool_input: toolInput,
          tool_output: payload,
          url: httpTargetFor(toolInput),
          method: httpMethodFor(toolInput),
          db_system: dbSystemFor(toolName, toolInput),
          db_operation: dbOperationFor(toolInput),
          db_statement: dbStatementFor(toolInput),
          error: failureError(env, payload),
        }),
      ]
    : undefined;
  const durationMs = durationMsFor(env);
  const verdict = await session.activity(EVENT.COMPLETE, activityType, {
    activityId: pending?.activityId,
    startTime: pending?.startTime,
    endTime: pending && durationMs !== undefined ? pending.startTime + durationMs : undefined,
    durationMs,
    input: withOpenBoxActivityMetadata(
      [stampSource(startedPayload, 'claude-code')],
      { toolType: effectiveSpanType },
    ),
    output: stampSource(payload, 'claude-code'),
    sessionId: env.session_id,
    toolName,
    toolType: effectiveSpanType ?? undefined,
    spans,
    hookSpanParentEventType: spans ? 'ActivityStarted' : undefined,
  });
  if (verdict.arm === 'halt') markHalted(env.session_id, cfg);
  return verdict;
}

export async function handlePostToolBatch(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeCodeConfig,
): Promise<WorkflowVerdict | undefined> {
  const payload = buildPostToolBatchPayload(env, sideEffects);
  const verdict = await session.activity(EVENT.COMPLETE, ACTIVITY_TYPES.AGENT_ACTION, {
    input: [stampSource(payload, 'claude-code')],
    output: stampSource(payload, 'claude-code'),
  });
  if (verdict.arm === 'halt') markHalted(env.session_id, cfg);
  return verdict;
}
