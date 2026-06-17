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
import { buildSpan, type SpanType } from '../../../governance/spans.js';
import { stampSource } from '../../../approvals/source.js';
import { sideEffects } from '../side-effects.js';
import { isSkipped } from '../../../governance/skip-patterns.js';
import { takeToolActivity } from '../tool-activity-store.js';

function activityTypeFor(toolName: string): string {
  const direct = POST_TOOL_USE_ROUTING[toolName];
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

function durationMsFor(env: ClaudeCodeEnvelope): number | undefined {
  const durationMs = env.duration_ms;
  return typeof durationMs === 'number' && Number.isFinite(durationMs)
    ? durationMs
    : undefined;
}

function outputFor(env: ClaudeCodeEnvelope, payload: Record<string, unknown>): unknown {
  return env.tool_response ?? env.tool_output ?? payload.output;
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
  if ((cfg.skipTools ?? []).includes(toolName)) return undefined;

  const activityType = activityTypeFor(toolName);
  if ((cfg.skipActivityTypes ?? []).includes(activityType)) return undefined;

  const filePath = (toolInput.file_path ?? toolInput.filePath ?? toolInput.path ?? toolInput.notebook_path ?? '') as string;
  if (filePath && isSkipped(filePath)) return undefined;

  const pending = takeToolActivity(env, cfg);
  const toolResponse = outputFor(env, {});
  const payload = buildPostToolUsePayload(env, sideEffects);
  const startedPayload = buildPreToolUsePayload(env, toolName, sideEffects);
  const spanType = spanTypeFor(toolName);
  const spans = spanType
    ? [
        buildSpan('claude-code', spanType, {
          file_path: (toolInput.file_path ?? toolInput.filePath ?? toolInput.path ?? toolInput.notebook_path) as string | undefined,
          command: toolInput.command as string | undefined,
          cwd: toolInput.cwd as string | undefined,
          tool_name: toolName,
          tool_output: toolResponse,
          url: (toolInput.url as string) || (toolInput.query as string) || undefined,
          method: 'GET',
        }),
      ]
    : undefined;
  const durationMs = durationMsFor(env);
  const verdict = await session.activity(EVENT.COMPLETE, activityType, {
    activityId: pending?.activityId,
    startTime: pending?.startTime,
    endTime: pending && durationMs !== undefined ? pending.startTime + durationMs : undefined,
    durationMs,
    input: [stampSource(startedPayload, 'claude-code')],
    output: outputFor(env, payload),
    spans,
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
  if ((cfg.skipTools ?? []).includes(toolName)) return undefined;

  const activityType = activityTypeFor(toolName);
  if ((cfg.skipActivityTypes ?? []).includes(activityType)) return undefined;
  const filePath = (toolInput.file_path ?? toolInput.filePath ?? toolInput.path ?? toolInput.notebook_path ?? '') as string;
  if (filePath && isSkipped(filePath)) return undefined;

  const pending = takeToolActivity(env, cfg);
  const payload = buildPostToolUseFailurePayload(env);
  const startedPayload = buildPreToolUsePayload(env, toolName, sideEffects);
  const durationMs = durationMsFor(env);
  const verdict = await session.activity(EVENT.COMPLETE, activityType, {
    activityId: pending?.activityId,
    startTime: pending?.startTime,
    endTime: pending && durationMs !== undefined ? pending.startTime + durationMs : undefined,
    durationMs,
    input: [stampSource(startedPayload, 'claude-code')],
    output: stampSource(payload, 'claude-code'),
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
