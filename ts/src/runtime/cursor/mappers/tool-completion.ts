import type {
  CursorSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { CursorEnvelope } from '../../../core-client/generated/runtime/cursor.js';
import {
  PRE_TOOL_USE_ROUTING,
  PRE_TOOL_USE_VARIANTS,
  applyActivityVariant,
  buildPostToolUseFailurePayload,
  buildPostToolUsePayload,
} from '../../../core-client/generated/runtime/cursor.js';
import type { CursorConfig } from '../config.js';
import { EVENT } from '../activity-types.js';
import {
  buildSpan,
  withOpenBoxActivityMetadata,
  type SpanType,
} from '../../../governance/spans.js';
import { stampSource } from '../../../approvals/source.js';

type ObserveCapableCursorSession = CursorSession & {
  observeActivity?: CursorSession['activity'];
};

function recordFrom(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberFrom(value: unknown): number | undefined {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : undefined;
  return parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined;
}

function toolInput(env: CursorEnvelope): Record<string, unknown> {
  return recordFrom(env.tool_input);
}

function toolCommand(env: CursorEnvelope): string | undefined {
  const input = toolInput(env);
  return stringFrom(input.command) ?? stringFrom(env.command);
}

function toolFilePath(env: CursorEnvelope): string | undefined {
  const input = toolInput(env);
  return (
    stringFrom(input.file_path) ??
    stringFrom(input.filePath) ??
    stringFrom(input.path) ??
    stringFrom(env.file_path)
  );
}

function cursorDurationMs(env: CursorEnvelope): number | undefined {
  const source = env as CursorEnvelope & { duration?: unknown };
  return numberFrom(source.duration_ms ?? source.duration);
}

function activityTypeFor(env: CursorEnvelope): string {
  const toolName = env.tool_name ?? '';
  const override = applyActivityVariant(PRE_TOOL_USE_VARIANTS, toolName, env);
  return override?.activityType ?? PRE_TOOL_USE_ROUTING[toolName] ?? (toolName || 'ToolCall');
}

function spanTypeFor(env: CursorEnvelope): SpanType {
  const toolName = env.tool_name ?? '';
  const override = applyActivityVariant(PRE_TOOL_USE_VARIANTS, toolName, env);
  if (override?.activityType === 'FileDelete') return 'file_delete';
  if (toolName === 'Read') return 'file_read';
  if (toolName === 'Write') return 'file_write';
  if (toolName === 'Shell') return 'shell';
  return 'mcp';
}

function spanInput(env: CursorEnvelope): Parameters<typeof buildSpan>[2] {
  return {
    file_path: toolFilePath(env),
    command: toolCommand(env),
    cwd: stringFrom(toolInput(env).cwd) ?? stringFrom(env.cwd),
    tool_name: env.tool_name,
    tool_input: env.tool_input,
    tool_output: env.tool_output,
  };
}

function shouldEmitPostToolUse(env: CursorEnvelope): boolean {
  return Boolean(env.tool_name || env.tool_use_id || env.tool_output !== undefined);
}

function shouldEmitPostToolUseFailure(env: CursorEnvelope): boolean {
  return Boolean(
    env.tool_name ||
      env.tool_use_id ||
      env.error_message ||
      env.failure_type ||
      env.is_interrupt !== undefined,
  );
}

async function observeActivity(
  session: CursorSession,
  eventType: 'ActivityCompleted',
  activityType: string,
  payload: Parameters<CursorSession['activity']>[2],
): Promise<WorkflowVerdict> {
  const observeSession = session as ObserveCapableCursorSession;
  if (observeSession.observeActivity) {
    return observeSession.observeActivity(eventType, activityType, payload);
  }
  return session.activity(eventType, activityType, payload);
}

export async function handlePostToolUse(
  env: CursorEnvelope,
  session: CursorSession,
  _cfg: CursorConfig,
): Promise<undefined> {
  if (!shouldEmitPostToolUse(env)) return undefined;
  const activityType = activityTypeFor(env);
  const toolType = spanTypeFor(env);
  const payload = buildPostToolUsePayload(env);
  await observeActivity(session, EVENT.COMPLETE, activityType, {
    activityId: env.tool_use_id,
    durationMs: cursorDurationMs(env),
    input: withOpenBoxActivityMetadata(
      [stampSource({ tool_name: env.tool_name, tool_input: env.tool_input }, 'cursor')],
      { toolType },
    ),
    output: stampSource(payload, 'cursor'),
    sessionId: env.conversation_id,
    llmModel: env.model,
    toolName: env.tool_name,
    toolType,
    spans: [buildSpan('cursor', toolType, spanInput(env))],
  });
  return undefined;
}

export async function handlePostToolUseFailure(
  env: CursorEnvelope,
  session: CursorSession,
  _cfg: CursorConfig,
): Promise<undefined> {
  if (!shouldEmitPostToolUseFailure(env)) return undefined;
  const activityType = activityTypeFor(env);
  const toolType = spanTypeFor(env);
  const payload = buildPostToolUseFailurePayload(env);
  await observeActivity(session, EVENT.COMPLETE, activityType, {
    activityId: env.tool_use_id,
    durationMs: cursorDurationMs(env),
    input: withOpenBoxActivityMetadata(
      [stampSource({ tool_name: env.tool_name, tool_input: env.tool_input }, 'cursor')],
      { toolType },
    ),
    output: stampSource(payload, 'cursor'),
    sessionId: env.conversation_id,
    toolName: env.tool_name,
    toolType,
    finishReason: stringFrom(env.failure_type) ?? 'failed',
    spans: [buildSpan('cursor', toolType, spanInput(env))],
  });
  return undefined;
}
