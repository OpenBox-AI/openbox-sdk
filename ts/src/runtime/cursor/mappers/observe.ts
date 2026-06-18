import type {
  CursorSession,
  GovernedPayload,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { CursorEnvelope } from '../../../core-client/generated/runtime/cursor.js';
import {
  AFTER_AGENT_RESPONSE_ACTIVITY_TYPE,
  AFTER_SHELL_EXECUTION_ACTIVITY_TYPE,
  buildAfterAgentResponsePayload,
  buildAfterShellExecutionPayload,
} from '../../../core-client/generated/runtime/cursor.js';
import type { CursorConfig } from '../config.js';
import { clearSession } from '../session-resolver.js';
import { EVENT } from '../activity-types.js';
import {
  assistantOutputTelemetryFields,
  buildAssistantOutputSpan,
} from '../../../governance/assistant-output.js';
import {
  buildSpan,
  withOpenBoxActivityMetadata,
} from '../../../governance/spans.js';
import { stampSource } from '../../../approvals/source.js';
import { claimCompletionTelemetry } from '../dedup.js';

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

function firstRecord(...values: unknown[]): Record<string, unknown> {
  for (const value of values) {
    const record = recordFrom(value);
    if (Object.keys(record).length > 0) return record;
  }
  return {};
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
  const response = recordFrom(record.response);
  const output = recordFrom(record.output);
  const message = recordFrom(record.message);
  const metadata = firstRecord(
    record.response_metadata,
    record.responseMetadata,
    response.response_metadata,
    response.responseMetadata,
    output.response_metadata,
    output.responseMetadata,
    message.response_metadata,
    message.responseMetadata,
  );
  const usage = firstRecord(
    record.usage_metadata,
    record.usageMetadata,
    record.usage,
    response.usage_metadata,
    response.usageMetadata,
    output.usage_metadata,
    output.usageMetadata,
    message.usage_metadata,
    message.usageMetadata,
    metadata.usage,
    metadata.tokenUsage,
    metadata.token_usage,
  );
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
  const direct = textFromContent(value);
  if (direct) return direct;
  const record = recordFrom(value);
  return firstString(
    textFromContent(record.content),
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
    messageContent(source.response),
    textFromContent(env.content),
    source.text,
    messageContent(source.message),
    messageContent(source.output),
    messageContent(source.result),
  );
}

function textFromContent(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (!Array.isArray(value)) return undefined;
  const text = value
    .map((part) => {
      if (typeof part === 'string') return part;
      const record = recordFrom(part);
      return record.type === 'text' && typeof record.text === 'string'
        ? record.text
        : '';
    })
    .filter(Boolean)
    .join(' ')
    .trim();
  return text || undefined;
}

function hasToolCallsFrom(value: unknown): boolean {
  return hasToolCallBlocks(recordFrom(value));
}

function hasToolCallBlocks(record: Record<string, unknown>): boolean {
  if (arrayHasEntries(record.tool_calls) || arrayHasEntries(record.toolCalls)) {
    return true;
  }
  if (contentHasToolUse(record.content)) return true;
  const additional = recordFrom(record.additional_kwargs ?? record.additionalKwargs);
  if (
    arrayHasEntries(additional.tool_calls) ||
    arrayHasEntries(additional.toolCalls)
  ) {
    return true;
  }
  for (const key of ['response', 'message', 'output', 'result']) {
    const nested = recordFrom(record[key]);
    if (Object.keys(nested).length > 0 && hasToolCallBlocks(nested)) return true;
  }
  return false;
}

function arrayHasEntries(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function contentHasToolUse(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((part) => {
    const record = recordFrom(part);
    const type = typeof record.type === 'string' ? record.type : '';
    return type === 'tool_use' || type === 'tool_call' || type === 'function_call';
  });
}

function cursorModel(env: CursorEnvelope): string | undefined {
  const source = env as unknown as Record<string, unknown>;
  const response = recordFrom(source.response);
  const metadata = firstRecord(
    source.response_metadata,
    source.responseMetadata,
    response.response_metadata,
    response.responseMetadata,
  );
  return firstString(
    source.model,
    source.model_name,
    source.modelName,
    source.ls_model_name,
    source.lsModelName,
    env.subagent_model,
    response.model,
    response.model_name,
    response.modelName,
    metadata.model,
    metadata.model_name,
    metadata.modelName,
    metadata.ls_model_name,
    metadata.lsModelName,
  );
}

function cursorDurationMs(env: CursorEnvelope): number | undefined {
  const source = env as CursorEnvelope & { duration?: unknown };
  return numberFrom(source.duration_ms ?? source.duration);
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
    hasToolCalls: hasToolCallsFrom(source),
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
      hasToolCalls: hasToolCallsFrom(source),
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

export async function handleAfterShellExecution(
  env: CursorEnvelope,
  session: CursorSession,
  _cfg: CursorConfig,
): Promise<undefined> {
  const source = env as CursorEnvelope & { output?: unknown; sandbox?: unknown };
  const command = firstString(env.command);
  const output = source.output;
  const durationMs = cursorDurationMs(env);
  if (!command || (output === undefined && durationMs === undefined)) {
    return undefined;
  }
  if (
    !claimCompletionTelemetry({
      generation_id: env.generation_id,
      conversation_id: env.conversation_id,
      kind: 'shell',
      arg: command,
    })
  ) {
    return undefined;
  }

  const payload = buildAfterShellExecutionPayload(env);
  await observeActivity(session, EVENT.COMPLETE, AFTER_SHELL_EXECUTION_ACTIVITY_TYPE, {
    durationMs,
    input: withOpenBoxActivityMetadata(
      [stampSource({ command, cwd: env.cwd, event_category: 'agent_action' }, 'cursor')],
      { toolType: 'shell' },
    ),
    output: stampSource(payload, 'cursor'),
    sessionId: env.conversation_id,
    toolName: 'Shell',
    toolType: 'shell',
    spans: [
      buildSpan('cursor', 'shell', {
        command,
        cwd: env.cwd,
        tool_name: 'Shell',
        tool_output: output,
      }),
    ],
  });
  return undefined;
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
