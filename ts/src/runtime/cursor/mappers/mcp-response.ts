import type {
  CursorSession,
  GovernedPayload,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { CursorEnvelope } from '../../../core-client/generated/runtime/cursor.js';
import {
  AFTER_MCPEXECUTION_ACTIVITY_TYPE,
  buildAfterMCPExecutionPayload,
} from '../../../core-client/generated/runtime/cursor.js';
import type { CursorConfig } from '../config.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';
import { sideEffects } from '../side-effects.js';
import { stampSource } from '../../../approvals/source.js';
import { withOpenBoxActivityMetadata } from '../../../governance/spans.js';
import type { SpanType } from '../../../governance/spans.js';
import { buildCursorSpan } from './spans.js';
import { claimCompletionTelemetry, takeCompletionActivity } from '../dedup.js';
import {
  dbOperationFor,
  dbStatementFor,
  dbSystemFor,
  httpMethodFor,
  httpTargetFor,
  isDatabaseMcpTool,
  isHttpMcpTool,
} from '../../claude-code/mappers/tool-input.js';

type ObserveCapableCursorSession = CursorSession & {
  observeActivity?: (
    eventType: 'ActivityCompleted',
    activityType: string,
    payload: GovernedPayload,
  ) => Promise<WorkflowVerdict>;
};

function numberFrom(value: unknown): number | undefined {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : undefined;
  if (parsed === undefined || !Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return Math.trunc(parsed);
}

function cursorDurationMs(env: CursorEnvelope): number | undefined {
  const source = env as CursorEnvelope & { duration?: unknown };
  return numberFrom(source.duration_ms ?? source.duration);
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function spanTypeForMcpTool(
  toolName: string,
  toolInput: Record<string, unknown>,
): SpanType {
  if (isDatabaseMcpTool(toolName, toolInput)) return 'db';
  if (isHttpMcpTool(toolName, toolInput)) return 'http';
  return 'mcp';
}

function activityTypeForSpan(spanType: SpanType): string {
  if (spanType === 'db') return ACTIVITY_TYPES.DB_QUERY;
  if (spanType === 'http') return ACTIVITY_TYPES.API_CALL;
  return AFTER_MCPEXECUTION_ACTIVITY_TYPE;
}

function spanInputForMcpTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  spanType: SpanType,
  toolOutput: unknown,
): Record<string, unknown> {
  if (spanType === 'db') {
    return {
      stage: 'completed',
      tool_name: toolName,
      tool_input: toolInput,
      tool_output: toolOutput,
      db_system: dbSystemFor(toolName, toolInput),
      db_operation: dbOperationFor(toolInput),
      db_statement: dbStatementFor(toolInput),
    };
  }
  if (spanType === 'http') {
    return {
      stage: 'completed',
      tool_name: toolName,
      tool_input: toolInput,
      tool_output: toolOutput,
      url: httpTargetFor(toolInput),
      method: httpMethodFor(toolInput),
    };
  }
  return {
    stage: 'completed',
    tool_name: toolName,
    tool_input: toolInput,
    tool_output: toolOutput,
  };
}

async function observeActivity(
  session: CursorSession,
  activityType: string,
  payload: GovernedPayload,
): Promise<WorkflowVerdict> {
  const observeSession = session as ObserveCapableCursorSession;
  if (observeSession.observeActivity) {
    return observeSession.observeActivity(EVENT.COMPLETE, activityType, payload);
  }
  return session.activity(EVENT.COMPLETE, activityType, payload);
}

export async function handleAfterMCPExecution(
  env: CursorEnvelope,
  session: CursorSession,
  cfg: CursorConfig,
): Promise<undefined> {
  const toolName = env.tool_name ?? '';
  const durationMs = cursorDurationMs(env);
  if (!toolName || (env.result_json === undefined && durationMs === undefined)) {
    return undefined;
  }
  if (
    !claimCompletionTelemetry({
      generation_id: env.generation_id,
      conversation_id: env.conversation_id,
      kind: 'mcp',
      arg: toolName,
    })
  ) {
    return undefined;
  }
  const pending = takeCompletionActivity(
    {
      generation_id: env.generation_id,
      conversation_id: env.conversation_id,
      kind: 'mcp',
      arg: toolName,
    },
    cfg,
  );

  const payload = buildAfterMCPExecutionPayload(env, sideEffects);
  const toolInput = recordFrom(env.tool_input);
  const spanType = spanTypeForMcpTool(toolName, toolInput);
  const activityType = pending?.activityType ?? activityTypeForSpan(spanType);
  await observeActivity(session, activityType, {
    activityId: pending?.activityId,
    startTime: pending?.startTime,
    durationMs,
    input: withOpenBoxActivityMetadata(
      [stampSource({
        tool_name: toolName,
        tool_input: env.tool_input,
        event_category: 'agent_action',
      }, 'cursor')],
      { toolType: spanType },
    ),
    output: stampSource(payload, 'cursor'),
    sessionId: env.conversation_id,
    toolName,
    toolType: spanType,
    spans: [
      buildCursorSpan(
        spanType,
        spanInputForMcpTool(toolName, toolInput, spanType, payload.tool_output),
      ),
    ],
    hookSpanParentEventType: EVENT.START,
  });
  return undefined;
}
