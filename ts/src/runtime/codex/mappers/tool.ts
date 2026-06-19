import type {
  CodexSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { CodexEnvelope } from '../../../core-client/generated/runtime/codex.js';
import {
  PRE_TOOL_USE_ROUTING,
  buildPostToolUsePayload,
  buildPreToolUsePayload,
} from '../../../core-client/generated/runtime/codex.js';
import { stampSource } from '../../../approvals/source.js';
import { EVENT } from '../../../governance/events.js';
import {
  buildSpan,
  withOpenBoxActivityMetadata,
  type SpanType,
} from '../../../governance/spans.js';
import type { CodexConfig } from '../config.js';
import { CODEX_ACTIVITY_TYPES } from '../activity-types.js';
import { sideEffects } from '../side-effects.js';
import { codexSessionKey, markHalted } from '../session-resolver.js';
import { rememberToolActivity, takeToolActivity } from '../tool-activity-store.js';
import {
  dbOperationFor,
  dbStatementFor,
  dbSystemFor,
  filePathFor,
  httpMethodFor,
  httpTargetFor,
  isDatabaseMcpTool,
} from '../../claude-code/mappers/tool-input.js';

function activityTypeFor(toolName: string, toolInput: Record<string, unknown>): string {
  const direct = PRE_TOOL_USE_ROUTING[toolName];
  if (direct) return direct;
  if (isDatabaseMcpTool(toolName, toolInput)) return CODEX_ACTIVITY_TYPES.DB_QUERY;
  if (toolName.startsWith('mcp__')) return CODEX_ACTIVITY_TYPES.MCP_CALL;
  return CODEX_ACTIVITY_TYPES.AGENT_ACTION;
}

function spanTypeFor(toolName: string, toolInput: Record<string, unknown>): SpanType | null {
  if (toolName === 'Read' || toolName === 'Glob' || toolName === 'Grep') return 'file_read';
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit') return 'file_write';
  if (toolName === 'Delete') return 'file_delete';
  if (toolName === 'Bash' || toolName === 'Shell') return 'shell';
  if (toolName === 'WebFetch' || toolName === 'WebSearch') return 'http';
  if (isDatabaseMcpTool(toolName, toolInput)) return 'db';
  if (toolName.startsWith('mcp__')) return 'mcp';
  return null;
}

function durationMsFor(env: CodexEnvelope): number | undefined {
  const durationMs = env.duration_ms;
  return typeof durationMs === 'number' && Number.isFinite(durationMs)
    ? durationMs
    : undefined;
}

function spanFor(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolOutput?: unknown,
  stage?: 'started' | 'completed',
): ReturnType<typeof buildSpan> | undefined {
  const spanType = spanTypeFor(toolName, toolInput);
  if (!spanType) return undefined;
  return buildSpan('codex', spanType, {
    stage,
    file_path: filePathFor(toolInput),
    command: toolInput.command as string | undefined,
    cwd: toolInput.cwd as string | undefined,
    tool_name: toolName,
    tool_input: toolInput,
    tool_output: toolOutput,
    url: httpTargetFor(toolInput),
    method: httpMethodFor(toolInput),
    db_system: dbSystemFor(toolName, toolInput),
    db_operation: dbOperationFor(toolInput),
    db_statement: dbStatementFor(toolInput),
  });
}

export async function handlePreToolUse(
  env: CodexEnvelope,
  session: CodexSession,
  cfg: CodexConfig,
): Promise<WorkflowVerdict | undefined> {
  const toolName = env.tool_name ?? '';
  const toolInput = (env.tool_input ?? {}) as Record<string, unknown>;
  const activityType = activityTypeFor(toolName, toolInput);
  const payload = buildPreToolUsePayload(env, toolName, sideEffects);
  const span = spanFor(toolName, toolInput);
  const spanType = spanTypeFor(toolName, toolInput);
  const startTime = Date.now();
  const opened = await session.openActivity(activityType, {
    input: withOpenBoxActivityMetadata(
      [stampSource(payload, 'codex')],
      { toolType: spanType ?? undefined },
    ),
    sessionId: codexSessionKey(env),
    toolName,
    toolType: spanType ?? undefined,
    startTime,
    spans: span ? [span] : undefined,
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
  if (verdict.arm === 'halt') markHalted(env, cfg);
  return verdict;
}

export async function handlePermissionRequest(
  env: CodexEnvelope,
  session: CodexSession,
  cfg: CodexConfig,
): Promise<WorkflowVerdict | undefined> {
  const toolName = env.tool_name ?? 'unknown';
  const toolInput = (env.tool_input ?? {}) as Record<string, unknown>;
  const activityType = activityTypeFor(toolName, toolInput);
  const payload = buildPreToolUsePayload(env, toolName, sideEffects);
  const span = spanFor(toolName, toolInput);
  const spanType = spanTypeFor(toolName, toolInput);
  const verdict = await session.activity(EVENT.START, activityType, {
    input: withOpenBoxActivityMetadata(
      [stampSource(payload, 'codex')],
      { toolType: spanType ?? undefined },
    ),
    sessionId: codexSessionKey(env),
    toolName,
    toolType: spanType ?? undefined,
    spans: span ? [span] : undefined,
  });
  if (verdict.arm === 'halt') markHalted(env, cfg);
  return verdict;
}

export async function handlePostToolUse(
  env: CodexEnvelope,
  session: CodexSession,
  cfg: CodexConfig,
): Promise<WorkflowVerdict | undefined> {
  const toolName = env.tool_name ?? '';
  const toolInput = (env.tool_input ?? {}) as Record<string, unknown>;
  const activityType = activityTypeFor(toolName, toolInput);
  const payload = buildPostToolUsePayload(env);
  const startedPayload = buildPreToolUsePayload(env, toolName, sideEffects);
  const pending = takeToolActivity(env, cfg);
  const durationMs = durationMsFor(env);
  const output = env.tool_output ?? env.response ?? payload.output;
  const span = spanFor(toolName, toolInput, output, 'completed');
  const spanType = spanTypeFor(toolName, toolInput);
  const verdict = await session.activity(EVENT.COMPLETE, activityType, {
    activityId: pending?.activityId,
    startTime: pending?.startTime,
    endTime: pending && durationMs !== undefined ? pending.startTime + durationMs : undefined,
    durationMs,
    input: withOpenBoxActivityMetadata(
      [stampSource(startedPayload, 'codex')],
      { toolType: spanType ?? undefined },
    ),
    output: stampSource({ ...payload, output }, 'codex'),
    sessionId: codexSessionKey(env),
    toolName,
    toolType: spanType ?? undefined,
    spans: span ? [span] : undefined,
    hookSpanParentEventType: span ? 'ActivityStarted' : undefined,
    ensureHookSpanParent: span ? !pending : undefined,
  });
  if (verdict.arm === 'halt') markHalted(env, cfg);
  return verdict;
}
