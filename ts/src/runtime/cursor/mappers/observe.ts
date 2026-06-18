import type {
  CursorSession,
  GovernedPayload,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { CursorEnvelope } from '../../../core-client/generated/runtime/cursor.js';
import {
  AFTER_AGENT_RESPONSE_ACTIVITY_TYPE,
  buildAfterAgentResponsePayload,
} from '../../../core-client/generated/runtime/cursor.js';
import type { CursorConfig } from '../config.js';
import { clearSession } from '../session-resolver.js';
import { EVENT } from '../activity-types.js';
import {
  assistantOutputTelemetryFields,
  buildAssistantOutputSpan,
} from '../../../governance/assistant-output.js';
import { stampSource } from '../../../approvals/source.js';

type ObserveCapableCursorSession = CursorSession & {
  observeActivity?: (
    eventType: 'ActivityStarted' | 'ActivityCompleted' | 'SignalReceived',
    activityType: string,
    payload: GovernedPayload,
  ) => Promise<WorkflowVerdict>;
};

function recordFrom(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function numberFrom(value: unknown): number | undefined {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : undefined;
  if (numeric === undefined || !Number.isFinite(numeric) || numeric < 0) {
    return undefined;
  }
  return Math.trunc(numeric);
}

function usageFrom(value: unknown) {
  const record = recordFrom(value);
  const usage = recordFrom(record.usage);
  const normalized = {
    promptTokens: numberFrom(record.prompt_tokens ?? record.promptTokens ?? usage.prompt_tokens),
    completionTokens: numberFrom(
      record.completion_tokens ??
        record.completionTokens ??
        usage.completion_tokens,
    ),
    inputTokens: numberFrom(record.input_tokens ?? record.inputTokens ?? usage.input_tokens),
    outputTokens: numberFrom(record.output_tokens ?? record.outputTokens ?? usage.output_tokens),
    totalTokens: numberFrom(record.total_tokens ?? record.totalTokens ?? usage.total_tokens),
  };
  return Object.values(normalized).some((entry) => entry !== undefined)
    ? normalized
    : undefined;
}

function messageContent(value: unknown): string | undefined {
  const record = recordFrom(value);
  return firstString(
    record.content,
    record.text,
    record.response,
    record.message,
    record.output,
    record.result,
  );
}

function cursorAssistantContent(env: CursorEnvelope): string | undefined {
  const source = env as unknown as Record<string, unknown>;
  return firstString(
    env.response,
    env.content,
    source.text,
    messageContent(source.message),
    messageContent(source.output),
    messageContent(source.result),
  );
}

function cursorModel(env: CursorEnvelope): string | undefined {
  const source = env as unknown as Record<string, unknown>;
  return firstString(source.model, env.subagent_model, recordFrom(source.response).model);
}

async function observeActivity(
  session: CursorSession,
  eventType: 'ActivityStarted' | 'ActivityCompleted' | 'SignalReceived',
  activityType: string,
  payload: GovernedPayload,
): Promise<WorkflowVerdict> {
  const observeSession = session as ObserveCapableCursorSession;
  if (observeSession.observeActivity) {
    return observeSession.observeActivity(eventType, activityType, payload);
  }
  return session.activity(eventType, activityType, payload);
}

export async function handleAfterAgentResponse(
  env: CursorEnvelope,
  session: CursorSession,
  _cfg: CursorConfig,
): Promise<undefined> {
  const payload = buildAfterAgentResponsePayload(env);
  const content = cursorAssistantContent(env);
  const source = env as unknown as Record<string, unknown>;
  const model = cursorModel(env);
  const usage = usageFrom(source);
  if (!content && !usage) return undefined;

  const telemetry = assistantOutputTelemetryFields({
    source: 'cursor',
    sessionId: env.conversation_id,
    content,
    model,
    usage,
  });
  await observeActivity(session, EVENT.COMPLETE, AFTER_AGENT_RESPONSE_ACTIVITY_TYPE, {
    input: [stampSource(payload, 'cursor')],
    output: stampSource({ ...payload, response: content }, 'cursor'),
    ...telemetry,
    spans: buildAssistantOutputSpan({
      source: 'cursor',
      content,
      name: 'openbox.cursor.assistant_output',
      model,
      usage,
      providerUrl: 'https://api.openai.com/v1/chat/completions',
      attributes: {
        'openbox.cursor.event': 'afterAgentResponse',
      },
      data: {
        source: 'cursor',
        hook_event_name: env.hook_event_name,
        conversation_id: env.conversation_id,
        generation_id: env.generation_id,
      },
    }),
  });
  return undefined;
}

export function handleAfterAgentThought(
  _env: CursorEnvelope,
  _session: CursorSession,
  _cfg: CursorConfig,
): Promise<undefined> {
  return Promise.resolve(undefined);
}

export function handleAfterShellExecution(
  _env: CursorEnvelope,
  _session: CursorSession,
  _cfg: CursorConfig,
): Promise<undefined> {
  return Promise.resolve(undefined);
}

export function handleAfterFileEdit(
  _env: CursorEnvelope,
  _session: CursorSession,
  _cfg: CursorConfig,
): Promise<undefined> {
  return Promise.resolve(undefined);
}

// Lifecycle: still fire workflowStarted / workflowCompleted so the
// SDK's session lifecycle is bookended properly (Temporal workflow
// open/close), but no activity emission alongside.
export async function handleSessionStart(
  _env: CursorEnvelope,
  session: CursorSession,
  _cfg: CursorConfig,
): Promise<undefined> {
  try {
    await session.workflowStarted();
  } catch {
    /* best-effort */
  }
  return undefined;
}

export async function handleStop(
  env: CursorEnvelope,
  session: CursorSession,
  cfg: CursorConfig,
): Promise<undefined> {
  try {
    await session.workflowCompleted();
  } catch {
    /* best-effort */
  }
  clearSession(env.conversation_id, cfg);
  return undefined;
}

// sessionEnd is distinct from `stop` (`stop` is per-turn, sessionEnd
// is per-conversation). Mirror handleStop so either signal closes
// the workflow cleanly.
export async function handleSessionEnd(
  env: CursorEnvelope,
  session: CursorSession,
  cfg: CursorConfig,
): Promise<undefined> {
  try {
    await session.workflowCompleted();
  } catch {
    /* best-effort */
  }
  clearSession(env.conversation_id, cfg);
  return undefined;
}

// Observe-only file events do not emit ActivityCompleted. Completed currently
// re-enters behavior-rule evaluation, so emitting it here would create a second
// approval row instead of closing the original activity.

// Observe-only siblings for the tab-driven file ops and pre-compact /
// subagent-stop signals. Same reasoning as the other after* mappers:
// the action either already happened or carries no governance value,
// so skip the backend round-trip.
export function handleAfterTabFileEdit(
  _env: CursorEnvelope,
  _session: CursorSession,
  _cfg: CursorConfig,
): Promise<undefined> {
  return Promise.resolve(undefined);
}

export function handlePreCompact(
  _env: CursorEnvelope,
  _session: CursorSession,
  _cfg: CursorConfig,
): Promise<undefined> {
  return Promise.resolve(undefined);
}

export function handleSubagentStop(
  _env: CursorEnvelope,
  _session: CursorSession,
  _cfg: CursorConfig,
): Promise<undefined> {
  return Promise.resolve(undefined);
}
