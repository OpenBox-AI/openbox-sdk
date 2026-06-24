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
import { EVENT } from '../activity-types.js';
import { sideEffects } from '../side-effects.js';
import { stampSource } from '../../../approvals/source.js';
import { withOpenBoxActivityMetadata } from '../../../governance/spans.js';
import { buildCursorSpan } from './spans.js';
import { claimCompletionTelemetry, takeCompletionActivity } from '../dedup.js';

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
  await observeActivity(session, pending?.activityType ?? AFTER_MCPEXECUTION_ACTIVITY_TYPE, {
    activityId: pending?.activityId,
    startTime: pending?.startTime,
    durationMs,
    input: withOpenBoxActivityMetadata(
      [stampSource({
        tool_name: toolName,
        tool_input: env.tool_input,
        event_category: 'agent_action',
      }, 'cursor')],
      { toolType: 'mcp' },
    ),
    output: stampSource(payload, 'cursor'),
    sessionId: env.conversation_id,
    toolName,
    toolType: 'mcp',
    spans: [
      buildCursorSpan('mcp', {
        stage: 'completed',
        tool_name: toolName,
        tool_input: env.tool_input,
        tool_output: payload.tool_output,
      }),
    ],
    hookSpanParentEventType: EVENT.START,
  });
  return undefined;
}
