import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { SpanData } from '../core-client/core-client.js';
import type { GovernedPayload, WorkflowVerdict } from '../core-client/index.js';
import { PRESET_ACTIVITY_TYPES } from '../core-client/generated/govern.js';
import { EVENT } from '../governance/events.js';
import {
  buildSpan,
  leanCopilotLlmSpan,
  stripServerComputedSemantic,
  withOpenBoxActivityMetadata,
  type LLMTokenUsage,
  type OpenBoxActivityMetadataInput,
  type SpanType,
} from '../governance/spans.js';
import { normalizeOpenBoxUsage } from '../governance/usage.js';
import {
  assistantOutputTelemetryFields,
  buildAssistantOutputSpan,
} from '../governance/assistant-output.js';
import {
  errorMessage,
  nowUnixNano,
  sameJson,
  swallow,
} from './internal-utils.js';
import { applyOpenBoxTransform, isAllowed, safePayload } from './results.js';
import type {
  OpenBoxCopilotGateInput,
  OpenBoxCopilotGateKind,
  OpenBoxCopilotKitAdapter,
  OpenBoxCopilotSessionState,
  OpenBoxSafePayload,
} from './types.js';
import {
  createWorkflowSession,
  emitUserPromptSignal,
  ensureWorkflowStarted,
  failWorkflow,
  finishStoppedWorkflow,
  withSpanIdentityFromActivity,
} from './workflow-session.js';
import { COPILOTKIT_LLM_ACTIVITY_TYPE } from './activity-types.js';

const langchainActivity = PRESET_ACTIVITY_TYPES.langchain;
const activityStartTimesMs = new Map<string, number>();
const activityToolInputs = new Map<string, unknown>();
const activityPromptInputs = new Map<string, unknown>();

type GateTiming = {
  startTime?: number;
  endTime?: number;
  durationMs?: number;
  durationNs?: number;
};

type GateOverrides = Pick<
  OpenBoxCopilotGateInput,
  | 'llmModel'
  | 'llmProvider'
  | 'llmUsage'
  | 'startTime'
  | 'endTime'
  | 'durationMs'
  | 'llmCapture'
  | 'redactSensitiveHeaders'
> &
  GateTiming & {
    pairedToolInput?: unknown;
    pairedPromptInput?: unknown;
  };

// All gate emission goes through the spec-generated session runtime
// (core-client/generated/govern.ts), which owns the canonical envelope:
// activity pairing, constrain-proceeds semantics, and inline approval.
function gateSession(
  adapter: OpenBoxCopilotKitAdapter,
  ids: { workflowId: string; runId: string },
  workflowType: string,
  taskQueue: string,
) {
  return createWorkflowSession(adapter, ids, workflowType, taskQueue, {
    attached: true,
    inlineApproval: true,
  });
}

async function evaluateGate<T>(
  adapter: OpenBoxCopilotKitAdapter,
  input: OpenBoxCopilotGateInput<T> & {
    kind: OpenBoxCopilotGateKind;
    workflowType: string;
    taskQueue: string;
  },
  ids: { workflowId: string; runId: string; activityId: string },
): Promise<WorkflowVerdict> {
  const completed =
    input.kind === 'tool_output' || input.kind === 'assistant_output';
  const activityType = activityTypeForGate(
    input.kind,
    input.payload,
    input.activityType,
  );
  const timing = timingForGate(input.kind, ids, input);
  const activityKey = activityTimingKey(ids);
  if (input.kind === 'prompt') {
    activityPromptInputs.set(activityKey, input.payload);
  }
  if (input.kind === 'tool_input') {
    activityToolInputs.set(activityKey, input.payload);
  }
  const pairedToolInput =
    input.kind === 'tool_output'
      ? activityToolInputs.get(activityKey)
      : undefined;
  const pairedPromptInput =
    input.kind === 'assistant_output'
      ? activityPromptInputs.get(activityKey)
      : undefined;
  const overrides: GateOverrides = {
    ...input,
    ...timing,
    pairedToolInput,
    pairedPromptInput,
  };
  const spans = spansForGate(
    input.kind,
    activityType,
    input.payload,
    overrides,
  ).map((span, index) => {
    const lean = leanCopilotLlmSpan(span);
    const withParent = withParentSpanId(lean, ids.activityId);
    // The platform pairs a started span with its completion by span_id. The
    // primary span of each gate is the started/completed pair (the
    // prompt/assistant llm_completion span, or the tool-call span), so derive
    // its identity from the shared activity id; the prompt-started gate and
    // the assistant-completed gate then produce a matching span_id/trace_id.
    // Any additional spans (e.g. tool calls embedded in an assistant message)
    // keep their own identity.
    return index === 0 || (lean as { name?: string }).name === 'POST'
      ? withSpanIdentityFromActivity(withParent, ids.activityId)
      : withParent;
  });
  const telemetry = telemetryForGate(
    input.kind,
    activityType,
    input.payload,
    input.sessionKey,
    overrides,
  );
  const session = gateSession(
    adapter,
    { workflowId: ids.workflowId, runId: ids.runId },
    input.workflowType,
    input.taskQueue,
  );
  const spanParent =
    completed && spans && spans.length > 0
      ? {
          hookSpanParentEventType: EVENT.START,
          ensureHookSpanParent: input.parentActivityStarted !== true,
        }
      : {};
  if (input.kind === 'prompt') {
    const opened = await session.openActivity(activityType, {
      activityId: ids.activityId,
      input: promptActivityInput(input.payload),
      ...telemetry,
      startTime: timing.startTime,
      spans,
    });
    return opened.verdict;
  }
  if (input.kind === 'tool_input') {
    const opened = await session.openActivity(activityType, {
      activityId: ids.activityId,
      input: toolActivityInput(input.payload, activityType),
      ...telemetry,
      startTime: timing.startTime,
      spans,
    });
    return opened.verdict;
  }
  if (input.kind === 'tool_output') {
    activityToolInputs.delete(activityKey);
  }
  if (input.kind === 'assistant_output') {
    activityPromptInputs.delete(activityKey);
  }
  return session.activity(
    completed ? EVENT.COMPLETE : EVENT.START,
    activityType,
    completed
      ? {
          activityId: ids.activityId,
          output: input.payload,
          ...telemetry,
          startTime: timing.startTime,
          endTime: timing.endTime,
          durationMs: timing.durationMs,
          spans,
          ...spanParent,
        }
      : {
          activityId: ids.activityId,
          input: [input.payload],
          ...telemetry,
          startTime: timing.startTime,
          spans,
        },
  );
}

function activityTimingKey(ids: {
  workflowId: string;
  runId: string;
  activityId: string;
}): string {
  return `${ids.workflowId}:${ids.runId}:${ids.activityId}`;
}

function timingForGate<T>(
  kind: OpenBoxCopilotGateKind,
  ids: { workflowId: string; runId: string; activityId: string },
  input: OpenBoxCopilotGateInput<T>,
): GateTiming {
  const key = activityTimingKey(ids);
  if (kind === 'prompt' || kind === 'tool_input') {
    const startTime = input.startTime ?? Date.now();
    activityStartTimesMs.set(key, startTime);
    return { startTime };
  }

  const startTime = input.startTime ?? activityStartTimesMs.get(key);
  const endTime = input.endTime ?? Date.now();
  const durationMs =
    input.durationMs ??
    (typeof startTime === 'number' ? Math.max(1, endTime - startTime) : undefined);
  activityStartTimesMs.delete(key);
  return {
    startTime,
    endTime,
    durationMs,
    durationNs:
      typeof durationMs === 'number' ? Math.max(1, durationMs) * 1_000_000 : undefined,
  };
}

function spanTimestampNs(timeMs: number | undefined): number | undefined {
  if (timeMs === undefined || !Number.isFinite(timeMs)) return undefined;
  const value = Math.trunc(timeMs);
  return value > 0 && value < 100_000_000_000_000
    ? value * 1_000_000
    : value;
}

function withGateSpanTiming<T extends SpanData>(
  span: T,
  timing: GateTiming | undefined,
  stage: 'started' | 'completed',
): T {
  if (!timing) return span;
  const startTime = spanTimestampNs(timing.startTime);
  const endTime = spanTimestampNs(timing.endTime);
  return {
    ...span,
    ...(startTime !== undefined ? { start_time: startTime } : {}),
    ...(stage === 'started'
      ? { end_time: null, duration_ns: null }
      : {
          ...(endTime !== undefined ? { end_time: endTime } : {}),
          ...(timing.durationNs !== undefined
            ? {
                duration_ns: timing.durationNs,
                duration_ms: timing.durationNs / 1_000_000,
              }
            : {}),
        }),
  };
}

export async function governPipelineGate<T>(
  adapter: OpenBoxCopilotKitAdapter,
  input: OpenBoxCopilotGateInput<T> & {
    kind: OpenBoxCopilotGateKind;
    workflowType: string;
    taskQueue: string;
    haltedSessions: Map<
      string,
      Extract<OpenBoxCopilotSessionState, { status: 'halted' }>
    >;
    strict: boolean;
    redactionMode: 'transformed-only';
    ensureWorkflowStarted?: boolean;
  },
): Promise<OpenBoxSafePayload<T>> {
  const key = input.sessionKey ?? 'default';
  const halted = input.haltedSessions.get(key);
  const ids = {
    workflowId: halted?.workflowId ?? input.workflowId ?? randomUUID(),
    runId: halted?.runId ?? input.runId ?? randomUUID(),
    activityId: input.activityId ?? randomUUID(),
  };
  if (halted) return governHaltedPipelineGate(adapter, input, ids, key, halted);
  if (!adapter.isEnabled()) {
    const verdict: WorkflowVerdict = {
      arm: 'allow',
      reason: 'OpenBox disabled for local development.',
      riskScore: 0,
    };
    return safePayload(input.payload, input.payload, verdict, ids, false);
  }
  const promptText =
    input.kind === 'prompt' ? promptTextFromPayload(input.payload) : undefined;
  let workflowKnown = Boolean(input.workflowId && input.runId);
  try {
    const needsWorkflowStart =
      input.ensureWorkflowStarted ||
      !input.workflowId ||
      !input.runId ||
      input.workflowId === input.runId;
    if (input.kind === 'prompt') {
      if (shouldSkipPromptGate(input.payload, promptText)) {
        if (needsWorkflowStart) {
          await ensureWorkflowStarted(
            adapter,
            { workflowId: ids.workflowId, runId: ids.runId },
            input.workflowType,
            input.taskQueue,
          );
        }
        workflowKnown = true;
        const verdict: WorkflowVerdict = {
          arm: 'allow',
          reason: 'OpenBox skipped an empty prompt governance gate.',
          riskScore: 0,
        };
        return safePayload(input.payload, input.payload, verdict, ids, false);
      }
      await emitUserPromptSignal(
        adapter,
        { workflowId: ids.workflowId, runId: ids.runId },
        input.workflowType,
        input.taskQueue,
        promptText,
        input.sessionKey,
      );
    }
    if (needsWorkflowStart) {
      await ensureWorkflowStarted(
        adapter,
        { workflowId: ids.workflowId, runId: ids.runId },
        input.workflowType,
        input.taskQueue,
      );
    }
    workflowKnown = true;
    const verdict = await evaluateGate(adapter, input, ids);
    const transformed = isAllowed(verdict.arm)
      ? applyOpenBoxTransform(input.payload, verdict)
      : input.payload;
    const effectiveVerdict = verdict;
    const safe = isAllowed(effectiveVerdict.arm)
      ? applyOpenBoxTransform(transformed, effectiveVerdict)
      : transformed;
    const changed = !sameJson(safe, input.payload);
    const payload = safePayload(
      safe,
      input.payload,
      effectiveVerdict,
      ids,
      changed,
    );
    if (payload.status === 'blocked' || payload.status === 'halted') {
      await swallow(() =>
        finishStoppedWorkflow(
          adapter,
          { workflowId: ids.workflowId, runId: ids.runId },
          input.workflowType,
          input.taskQueue,
          verdict,
        ),
      );
    }
    if (payload.status === 'halted') {
      input.haltedSessions.set(
        key,
        payload.session as Extract<
          OpenBoxCopilotSessionState,
          { status: 'halted' }
        >,
      );
    }
    return payload;
  } catch (error) {
    if (workflowKnown) {
      await swallow(() =>
        failWorkflow(
          adapter,
          { workflowId: ids.workflowId, runId: ids.runId },
          input.workflowType,
          input.taskQueue,
          error,
        ),
      );
    }
    // Fail closed, but do not impersonate a governance decision: OpenBox was
    // unreachable, nothing was evaluated, and the result must say so.
    const verdict: WorkflowVerdict = {
      arm: 'block',
      reason: `OpenBox could not be reached; the action was not executed (failed closed). ${errorMessage(error)}`,
      riskScore: 0,
    };
    return { ...safePayload(input.payload, input.payload, verdict, ids, false), status: 'error' as const };
  }
}

async function governHaltedPipelineGate<T>(
  adapter: OpenBoxCopilotKitAdapter,
  input: OpenBoxCopilotGateInput<T> & {
    kind: OpenBoxCopilotGateKind;
    workflowType: string;
    taskQueue: string;
    haltedSessions: Map<
      string,
      Extract<OpenBoxCopilotSessionState, { status: 'halted' }>
    >;
  },
  ids: { workflowId: string; runId: string; activityId: string },
  key: string,
  halted: Extract<OpenBoxCopilotSessionState, { status: 'halted' }>,
): Promise<OpenBoxSafePayload<T>> {
  if (!adapter.isEnabled()) {
    const verdict: WorkflowVerdict = {
      arm: 'halt',
      reason: halted.reason,
      riskScore: 0,
    };
    return safePayload(input.payload, input.payload, verdict, ids, false);
  }

  let workflowKnown = Boolean(input.workflowId && input.runId);
  try {
    if (input.kind === 'prompt') {
      workflowKnown = true;
      await emitUserPromptSignal(
        adapter,
        { workflowId: ids.workflowId, runId: ids.runId },
        input.workflowType,
        input.taskQueue,
        promptTextFromPayload(input.payload),
        input.sessionKey,
      );
    }
    const verdict = await evaluateGate(adapter, input, ids);
    if (isAllowed(verdict.arm)) {
      const failClosedVerdict: WorkflowVerdict = {
        ...verdict,
        arm: 'block',
        reason:
          'OpenBox allowed a gate on a previously halted CopilotKit workflow.',
        riskScore: verdict.riskScore ?? 0,
      };
      return safePayload(
        input.payload,
        input.payload,
        failClosedVerdict,
        ids,
        false,
      );
    }

    const payload = safePayload(input.payload, input.payload, verdict, ids, false);
    if (payload.status === 'blocked' || payload.status === 'halted') {
      await swallow(() =>
        finishStoppedWorkflow(
          adapter,
          { workflowId: ids.workflowId, runId: ids.runId },
          input.workflowType,
          input.taskQueue,
          verdict,
        ),
      );
    }
    if (payload.status === 'halted') {
      input.haltedSessions.set(
        key,
        payload.session as Extract<
          OpenBoxCopilotSessionState,
          { status: 'halted' }
        >,
      );
    }
    return payload;
  } catch (error) {
    if (workflowKnown) {
      await swallow(() =>
        failWorkflow(
          adapter,
          { workflowId: ids.workflowId, runId: ids.runId },
          input.workflowType,
          input.taskQueue,
          error,
        ),
      );
    }
    // Fail closed, but do not impersonate a governance decision: OpenBox was
    // unreachable, nothing was evaluated, and the result must say so.
    const verdict: WorkflowVerdict = {
      arm: 'block',
      reason: `OpenBox could not be reached; the action was not executed (failed closed). ${errorMessage(error)}`,
      riskScore: 0,
    };
    return { ...safePayload(input.payload, input.payload, verdict, ids, false), status: 'error' as const };
  }
}

function shouldSkipPromptGate(payload: unknown, promptText: string | undefined): boolean {
  if (typeof payload === 'string') return !payload.trim();
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.messages)) return !promptText?.trim();
  if ('prompt' in record || 'request' in record || 'content' in record) {
    return !promptText?.trim();
  }
  return false;
}

function promptTextFromPayload(payload: unknown): string | undefined {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  if (typeof record.prompt === 'string') return record.prompt;
  if (typeof record.request === 'string') return record.request;
  if (typeof record.content === 'string') return record.content;
  if (Array.isArray(record.messages)) {
    const latestUser = [...record.messages]
      .reverse()
      .find(
        (message): message is Record<string, unknown> =>
          Boolean(message) &&
          typeof message === 'object' &&
          ['user', 'human'].includes(
            String((message as Record<string, unknown>).role ?? (message as Record<string, unknown>).type ?? ''),
          ),
      );
    const latestContent = [...record.messages]
      .reverse()
      .find(
        (message): message is Record<string, unknown> =>
          Boolean(message) &&
          typeof message === 'object' &&
          typeof (message as Record<string, unknown>).content === 'string' &&
          !['system', 'assistant', 'ai', 'tool'].includes(
            String((message as Record<string, unknown>).role ?? (message as Record<string, unknown>).type ?? ''),
          ),
      );
    const content = latestUser?.content ?? latestContent?.content;
    if (typeof content === 'string') return content;
  }
  return undefined;
}

function activityTypeForGate(
  kind: OpenBoxCopilotGateKind,
  payload?: unknown,
  requested?: string,
): string {
  switch (kind) {
    case 'prompt':
      return COPILOTKIT_LLM_ACTIVITY_TYPE;
    case 'tool_input':
      return requested ?? toolNameFromPayload(payload) ?? langchainActivity.onToolStart;
    case 'tool_output':
      return requested ?? toolNameFromPayload(payload) ?? langchainActivity.onToolEnd;
    case 'assistant_output':
      return requested === undefined || requested === langchainActivity.onLlmEnd
        ? COPILOTKIT_LLM_ACTIVITY_TYPE
        : requested;
  }
}

function llmCompletionMetadataFromPayload(payload: unknown): {
  model?: string;
  provider?: string;
  usage?: LLMTokenUsage;
  requestBody?: unknown;
  responseBody?: unknown;
  requestHeaders?: unknown;
  responseHeaders?: unknown;
  httpStatusCode?: unknown;
  providerUrl?: string;
} {
  const record = recordFrom(payload);
  const metadata = firstRecord(
    record.response_metadata,
    record.responseMetadata,
    record.lc_kwargs && recordFrom(record.lc_kwargs).response_metadata,
    record.lc_kwargs && recordFrom(record.lc_kwargs).responseMetadata,
  );
  const lcKwargs = recordFrom(record.lc_kwargs);
  const usageMetadata = firstRecord(
    record.usage_metadata,
    record.usageMetadata,
    record.usage,
    lcKwargs.usage_metadata,
    lcKwargs.usageMetadata,
    lcKwargs.usage,
    metadata.usage,
    metadata.tokenUsage,
    metadata.token_usage,
    metadata.usageMetadata,
    metadata.usage_metadata,
  );
  const model =
    firstString(
      record.model,
      record.model_name,
      record.modelName,
      record.ls_model_name,
      record.lsModelName,
      metadata.model,
      metadata.model_name,
      metadata.modelName,
      metadata.ls_model_name,
      metadata.lsModelName,
      metadata.model_id,
      metadata.modelId,
    ) ?? undefined;
  const provider = firstString(
    metadata.ls_provider,
    metadata.provider,
    metadata.model_provider,
    metadata.modelProvider,
    record.provider,
    record.model_provider,
    record.modelProvider,
    lcKwargs.model_provider,
    lcKwargs.modelProvider,
  );
  return {
    model,
    provider,
    usage: normalizeOpenBoxUsage(usageMetadata)?.raw,
    requestBody:
      record.request_body ??
      record.requestBody ??
      metadata.request_body ??
      metadata.requestBody,
    responseBody:
      record.response_body ??
      record.responseBody ??
      metadata.response_body ??
      metadata.responseBody,
    requestHeaders:
      record.request_headers ??
      record.requestHeaders ??
      metadata.request_headers ??
      metadata.requestHeaders,
    responseHeaders:
      record.response_headers ??
      record.responseHeaders ??
      metadata.response_headers ??
      metadata.responseHeaders,
    httpStatusCode:
      record.http_status_code ??
      record.httpStatusCode ??
      record.status_code ??
      record.statusCode ??
      metadata.http_status_code ??
      metadata.httpStatusCode ??
      metadata.status_code ??
      metadata.statusCode,
    providerUrl:
      firstString(
        record.http_url,
        record.httpUrl,
        record.url,
        metadata.http_url,
        metadata.httpUrl,
        metadata.url,
      ) ?? providerUrlFor(provider, model),
  };
}

function llmRequestBodyFromPrompt(
  payload: unknown,
  model?: string,
  provider?: string,
): Record<string, unknown> | undefined {
  if (payload === undefined) return undefined;
  const record = recordFrom(payload);
  const body: Record<string, unknown> = {};
  if (model) body.model = model;
  if (provider) {
    body.provider = provider;
    body.model_provider = provider;
  }
  if (Array.isArray(record.messages)) {
    body.messages = record.messages;
  } else {
    const prompt = promptTextFromPayload(payload);
    if (prompt) body.input = prompt;
  }
  return Object.keys(body).length > 0 ? body : undefined;
}

function providerUrlFor(
  provider: string | undefined,
  model: string | undefined,
): string | undefined {
  const normalized = provider?.toLowerCase();
  if (normalized?.includes('anthropic')) return 'https://api.anthropic.com/v1/messages';
  if (normalized?.includes('google') || normalized?.includes('gemini'))
    return 'https://generativelanguage.googleapis.com/v1beta/models';
  if (normalized?.includes('openai')) return 'https://api.openai.com/v1/chat/completions';
  if (model?.startsWith('gemini')) return 'https://generativelanguage.googleapis.com/v1beta/models';
  return undefined;
}

function telemetryForGate(
  kind: OpenBoxCopilotGateKind,
  activityType: string,
  payload: unknown,
  sessionKey?: string,
  overrides?: GateOverrides,
): Pick<
  GovernedPayload,
  | 'sessionId'
  | 'llmModel'
  | 'inputTokens'
  | 'outputTokens'
  | 'totalTokens'
  | 'costUsd'
  | 'prompt'
  | 'completion'
  | 'toolName'
  | 'toolType'
> {
  const sessionId = sessionKey === 'default' ? undefined : sessionKey;
  if (kind === 'prompt') {
    const metadata = llmCompletionMetadataFromPayload(payload);
    return {
      sessionId,
      prompt: promptTextFromPayload(payload),
      llmModel: metadata.model ?? overrides?.llmModel,
    };
  }
  if (kind === 'assistant_output') {
    const metadata = llmCompletionMetadataFromPayload(payload);
    const usage = metadata.usage ?? normalizeOpenBoxUsage(overrides?.llmUsage)?.raw;
    return {
      ...assistantOutputTelemetryFields({
        source: 'copilotkit',
        sessionId,
        content: assistantContentFromPayload(payload),
        model: metadata.model ?? overrides?.llmModel,
        provider: metadata.provider ?? overrides?.llmProvider,
        usage,
        hasToolCalls: hasToolCallsFromPayload(payload),
      }),
      sessionId,
    };
  }
  return {
    sessionId,
    toolName: toolNameFromPayload(payload) ?? activityType,
    toolType: toolMetadataFromPayload(payload, activityType).toolType ?? 'custom',
  };
}

function numberFrom(value: unknown): number | undefined {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : undefined;
  if (!Number.isFinite(numeric) || numeric === undefined) return undefined;
  return Math.trunc(numeric);
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstRecord(...values: unknown[]): Record<string, unknown> {
  for (const value of values) {
    const record = recordFrom(value);
    if (Object.keys(record).length > 0) return record;
  }
  return {};
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function toolActivityInput(payload: unknown, activityType: string): unknown[] {
  return withOpenBoxActivityMetadata(
    [payload],
    toolMetadataFromPayload(payload, activityType),
  ) as unknown[];
}

function promptActivityInput(payload: unknown): unknown[] {
  const prompt = promptTextFromPayload(payload);
  return prompt ? [{ prompt }] : [payload];
}

function toolMetadataFromPayload(
  payload: unknown,
  activityType: string,
): OpenBoxActivityMetadataInput {
  const record = recordFrom(payload);
  const args = recordFrom(record.args);
  const toolName = firstString(record.name, activityType);
  const subagentName = firstString(
    args.subagent_name,
    args.subagent_type,
    args.agent_type,
    args.agent_name,
    args.name,
    record.subagent_name,
    record.subagent_type,
  );
  if (toolName === 'Agent' || toolName === 'Task' || subagentName) {
    return { toolType: 'a2a', subagentName };
  }
  return {
    toolType: spanTypeForTool(toolName, toolInputFromPayload(payload)) ?? 'llm_tool_call',
  };
}

function spansForGate(
  kind: OpenBoxCopilotGateKind,
  activityType: string,
  payload: unknown,
  overrides?: GateOverrides,
): SpanData[] {
  switch (kind) {
    case 'assistant_output': {
      const content = assistantContentFromPayload(payload);
      const metadata = llmCompletionMetadataFromPayload(payload);
      const usage = metadata.usage ?? normalizeOpenBoxUsage(overrides?.llmUsage)?.raw;
      const capture = overrides?.llmCapture;
      if (!content && !usage && !capture) return [];
      // When the client-side capture path owns llm_completion spans
      // (OPENBOX_LLM_SPANS_FROM_CAPTURE=true), the runtime gate that has no
      // captured exchange suppresses its reconstructed span so the real
      // captured span (emitted by the middleware) is the only one. Default
      // off: the runtime keeps emitting its span for capture-less consumers.
      const emitLlmSpan =
        capture !== undefined ||
        process.env.OPENBOX_LLM_SPANS_FROM_CAPTURE !== 'true';
      const span = pipelineSpan(kind, 'llm.chat.completion', payload);
      const model = metadata.model ?? overrides?.llmModel;
      const provider = metadata.provider ?? overrides?.llmProvider;
      // When a real provider HTTP exchange was captured at the client
      // (OTel-style), use it verbatim so the span mirrors the wire payload:
      // raw bodies, real headers, real status. Otherwise fall back to the
      // metadata reconstructed from the AG-UI payload.
      const completionSpans = buildAssistantOutputSpan({
        source: 'copilotkit',
        content,
        span: {
          ...span,
          kind: 'CLIENT',
          hook_type: 'http_request',
        },
        name: 'POST',
        kind: 'CLIENT',
        model,
        provider,
        usage,
        requestBody:
          metadata.requestBody ??
          llmRequestBodyFromPrompt(overrides?.pairedPromptInput, model, provider),
        responseBody: metadata.responseBody,
        rawRequestBody: capture?.requestBody,
        rawResponseBody: capture?.responseBody,
        requestHeaders: capture?.requestHeaders ?? metadata.requestHeaders,
        responseHeaders: capture?.responseHeaders ?? metadata.responseHeaders,
        httpStatusCode: capture?.httpStatusCode ?? metadata.httpStatusCode ?? 200,
        redactSensitiveHeaders: overrides?.redactSensitiveHeaders,
        providerUrl:
          capture?.providerUrl ??
          metadata.providerUrl ??
          providerUrlFor(provider, model),
        startTime: overrides?.startTime,
        endTime: overrides?.endTime,
        durationNs: overrides?.durationNs,
        attributes: { 'gen_ai.system': 'copilotkit' },
        hasToolCalls: hasToolCallsFromPayload(payload),
      }) ?? [];
      // With a real captured exchange, also emit the matching STARTED span
      // (request only) from the same capture so BOTH stages carry full real
      // data and share one span_id — like the LangGraph/Temporal reference.
      const startedFromCapture =
        emitLlmSpan && capture
          ? [
              buildSpan('copilotkit', 'llm', {
                stage: 'started',
                model,
                rawRequestBody: capture.requestBody,
                request_headers: capture.requestHeaders,
                redactSensitiveHeaders: overrides?.redactSensitiveHeaders,
                data: payload,
              }) as unknown as SpanData,
            ]
          : [];
      // The assistant's tool-call decision is part of the llm_completion (the
      // assistant message's tool_calls live in this span's response_body), and
      // the actual execution is a separate governed-tool activity with its own
      // paired span. So we do NOT emit a separate llm_tool_call span on the
      // llm_call: it points at the /chat/completions endpoint (misleading — a
      // tool-call decision is not its own HTTP call), duplicates the call, and
      // produced orphaned started/completed spans. The reference llm_call is the
      // llm_completion pair only.
      return [
        ...startedFromCapture,
        ...(emitLlmSpan ? completionSpans : []),
      ];
    }
    case 'tool_input':
    case 'tool_output':
      return [toolCallSpan(kind, activityType, payload, overrides)];
    case 'prompt': {
      // In capture mode the assistant gate emits the full started+completed
      // pair from the real captured exchange, so suppress this pre-call started
      // span (which can only carry a reconstructed request) to avoid a partial
      // duplicate. Default off: capture-less hosts keep the prompt started span.
      if (process.env.OPENBOX_LLM_SPANS_FROM_CAPTURE === 'true') return [];
      const prompt = promptTextFromPayload(payload);
      const metadata = llmCompletionMetadataFromPayload(payload);
      const model = metadata.model ?? overrides?.llmModel;
      if (!prompt && !model) return [];
      return [
        withGateSpanTiming(
          buildSpan('copilotkit', 'llm', {
            stage: 'started',
            prompt,
            model,
            requestHeaders: metadata.requestHeaders,
            requestBody:
              metadata.requestBody ??
              llmRequestBodyFromPrompt(payload, model, metadata.provider),
            data: payload,
          }) as unknown as SpanData,
          overrides,
          'started',
        ),
      ];
    }
  }
}

function toolCallSpansFromAssistantPayload(
  payload: unknown,
  model: string | undefined,
  timing?: GateOverrides,
): SpanData[] {
  return toolCallsFromPayload(payload).flatMap((toolCall) => {
    const started = buildSpan('copilotkit', 'llm_tool_call', {
      stage: 'started',
      model,
      tool_name: toolCall.name,
      tool_input: toolCall.args,
      data: toolCall.raw,
    }) as unknown as SpanData;
    const completed = buildSpan('copilotkit', 'llm_tool_call', {
      stage: 'completed',
      model,
      tool_name: toolCall.name,
      tool_input: toolCall.args,
      tool_output: toolCall.raw,
      data: toolCall.raw,
    }) as unknown as SpanData;
    return [
      withGateSpanTiming(started, timing, 'started'),
      withGateSpanTiming(completed, timing, 'completed'),
    ];
  });
}

function parentSpanIdForActivity(activityId: string): string {
  return createHash('sha256').update(activityId).digest('hex').slice(0, 16);
}

function withParentSpanId<T extends SpanData>(span: T, activityId: string): T {
  if (typeof span.parent_span_id === 'string' && span.parent_span_id.trim()) {
    return span;
  }
  return {
    ...span,
    parent_span_id: parentSpanIdForActivity(activityId),
  };
}

function toolCallSpan(
  kind: Extract<OpenBoxCopilotGateKind, 'tool_input' | 'tool_output'>,
  activityType: string,
  payload: unknown,
  timing?: GateOverrides,
): SpanData {
  const requestPayload =
    kind === 'tool_output' && timing?.pairedToolInput !== undefined
      ? timing.pairedToolInput
      : payload;
  const toolName =
    toolNameFromPayload(payload) ??
    toolNameFromPayload(requestPayload) ??
    activityType ??
    'call';
  const toolInput = toolInputFromPayload(requestPayload);
  const spanType = spanTypeForTool(toolName, toolInput);
  if (spanType) {
    return withGateSpanTiming(
      buildSpan('copilotkit', spanType, {
        stage: kind === 'tool_input' ? 'started' : 'completed',
        file_path: filePathFor(toolInput),
        command: firstString(toolInput.command),
        cwd: firstString(toolInput.cwd),
        tool_name: toolName,
        tool_input: toolInput,
        tool_output: kind === 'tool_output' ? payload : undefined,
        data: payload,
        url: httpTargetFor(toolInput),
        method: httpMethodFor(toolInput),
        db_system: dbSystemFor(toolName, toolInput),
        db_operation: dbOperationFor(toolInput),
        db_statement: dbStatementFor(toolInput),
      }) as unknown as SpanData,
      timing,
      kind === 'tool_input' ? 'started' : 'completed',
    );
  }

  const now = nowUnixNano();
  const stage = kind === 'tool_input' ? 'started' : 'completed';
  return withGateSpanTiming(stripServerComputedSemantic({
    span_id: randomBytes(8).toString('hex'),
    trace_id: randomBytes(16).toString('hex'),
    name: `tool.${toolName}`,
    kind: 'tool',
    span_type: 'function',
    hook_type: 'function_call',
    start_time: now,
    end_time: stage === 'completed' ? now : null,
    duration_ns: stage === 'completed' ? 0 : null,
    stage,
    status: { code: 'UNSET' },
    events: [],
    attributes: {
      'gen_ai.system': 'copilotkit',
      'openbox.copilotkit.gate': kind,
      'openbox.activity_type': activityType,
      'openbox.span_type': 'function',
      'openbox.tool.name': toolName,
      'tool.name': toolName,
      tool_name: toolName,
    },
    data: payload,
    ...(stage === 'completed' ? { result: payload } : {}),
  } as SpanData), timing, stage);
}

function pipelineSpan(
  kind: OpenBoxCopilotGateKind,
  activityType: string,
  payload: unknown,
): SpanData {
  const now = nowUnixNano();
  const span = {
    span_id: randomBytes(8).toString('hex'),
    trace_id: randomBytes(16).toString('hex'),
    name: activityType,
    kind: 'internal',
    span_type: 'function',
    start_time: now,
    end_time: now,
    duration_ns: 0,
    stage: kind === 'prompt' || kind === 'tool_input' ? 'started' : 'completed',
    attributes: {
      'openbox.copilotkit.gate': kind,
      'openbox.activity_type': activityType,
    },
    data: payload,
  } as SpanData;
  if (kind !== 'assistant_output') return stripServerComputedSemantic(span);

  const assistantContent = assistantContentFromPayload(payload);
  if (!assistantContent) return stripServerComputedSemantic(span);
  return stripServerComputedSemantic({
    ...span,
    name: 'openbox.copilotkit.assistant_output',
    response_body: JSON.stringify({
      choices: [{ message: { content: assistantContent } }],
    }),
  } as SpanData);
}

function toolNameFromPayload(payload: unknown): string | undefined {
  const record = recordFrom(payload);
  const toolCall = recordFrom(record.toolCall);
  return firstString(
    record.toolName,
    record.tool_name,
    record.name,
    record.action,
    record.actionName,
    toolCall.name,
  );
}

function toolInputFromPayload(payload: unknown): Record<string, unknown> {
  const record = recordFrom(payload);
  const args = recordFrom(record.args);
  if (Object.keys(args).length > 0) return args;
  const toolCall = recordFrom(record.toolCall);
  const toolCallArgs = recordFrom(toolCall.args);
  if (Object.keys(toolCallArgs).length > 0) return toolCallArgs;
  return record;
}

function spanTypeForTool(
  toolName: string | undefined,
  toolInput: Record<string, unknown>,
): SpanType | null {
  const normalized = String(toolName ?? '').trim();
  const lower = normalized.toLowerCase();
  if (['agent', 'task'].includes(lower)) return null;
  if (['read', 'notebookread', 'glob', 'grep'].includes(lower) || toolInput.read === true)
    return 'file_read';
  if (
    (['open', 'fileopen'].includes(lower) || lower.includes('file_open') || lower.includes('open_file') || toolInput.open === true) &&
    filePathFor(toolInput)
  )
    return 'file_open';
  if (['write', 'edit', 'multiedit', 'notebookedit'].includes(lower))
    return 'file_write';
  if (lower === 'delete') return 'file_delete';
  if (['bash', 'shell', 'powershell', 'monitor'].includes(lower) || firstString(toolInput.command))
    return 'shell';
  if (isDatabaseMcpTool(normalized, toolInput)) return 'db';
  if (isHttpMcpTool(normalized, toolInput)) return 'http';
  if (lower.startsWith('mcp__') || lower.includes('mcp')) return 'mcp';
  if (['webfetch', 'websearch'].includes(lower) || httpTargetFor(toolInput))
    return 'http';
  return 'llm_tool_call';
}

function filePathFor(toolInput: Record<string, unknown>): string | undefined {
  return firstString(
    toolInput.file_path,
    toolInput.filePath,
    toolInput.path,
    toolInput.notebook_path,
  );
}

function httpTargetFor(toolInput: Record<string, unknown>): string | undefined {
  return firstString(toolInput.url, toolInput.uri, toolInput.href, toolInput.query);
}

function httpMethodFor(toolInput: Record<string, unknown>): string {
  return firstString(toolInput.method, toolInput.http_method, toolInput.httpMethod)?.toUpperCase() ?? 'GET';
}

function dbStatementFor(toolInput: Record<string, unknown>): string | undefined {
  const explicit = firstString(
    toolInput.db_statement,
    toolInput.dbStatement,
    toolInput.statement,
    toolInput.sql,
    toolInput.query,
  );
  if (explicit) return explicit;
  const resource = firstString(
    toolInput.resource,
    toolInput.table,
    toolInput.collection,
    toolInput.entity,
  );
  return resource ? `database resource ${resource}` : undefined;
}

const SQL_VERBS = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'CREATE',
  'DROP',
  'ALTER',
  'TRUNCATE',
  'BEGIN',
  'COMMIT',
  'ROLLBACK',
  'EXPLAIN',
] as const;

function dbOperationFromStatement(statement: string | undefined): string | undefined {
  if (!statement) return undefined;
  const normalized = statement.trim().toUpperCase();
  return SQL_VERBS.find((verb) => normalized.startsWith(verb));
}

function dbSystemFor(toolName: string, toolInput: Record<string, unknown>): string {
  const explicit = firstString(
    toolInput.db_system,
    toolInput.dbSystem,
    toolInput.system,
    toolInput.database_system,
  );
  if (explicit) return explicit;
  const lowerName = toolName.toLowerCase();
  if (lowerName.includes('sqlite')) return 'sqlite';
  if (lowerName.includes('mysql')) return 'mysql';
  if (lowerName.includes('postgres')) return 'postgresql';
  return 'postgresql';
}

function dbOperationFor(toolInput: Record<string, unknown>): string {
  const statementOperation = dbOperationFromStatement(dbStatementFor(toolInput));
  const explicitOperation = firstString(
    toolInput.db_operation,
    toolInput.dbOperation,
    toolInput.operation,
  )?.toUpperCase();
  if (
    explicitOperation &&
    explicitOperation !== 'QUERY' &&
    explicitOperation !== 'UNKNOWN'
  ) {
    return explicitOperation;
  }
  return statementOperation ?? explicitOperation ?? 'QUERY';
}

function isDatabaseMcpTool(
  toolName: string,
  toolInput: Record<string, unknown>,
): boolean {
  if (!toolName.startsWith('mcp__')) return false;
  const lowerName = toolName.toLowerCase();
  const nameLooksDatabase =
    lowerName.includes('db') ||
    lowerName.includes('sql') ||
    lowerName.includes('database') ||
    lowerName.includes('postgres') ||
    lowerName.includes('mysql') ||
    lowerName.includes('sqlite');
  if (!nameLooksDatabase) return false;
  return Boolean(dbStatementFor(toolInput)) ||
    lowerName.includes('query') ||
    lowerName.includes('execute') ||
    lowerName.includes('select');
}

function isHttpMcpTool(
  toolName: string,
  toolInput: Record<string, unknown>,
): boolean {
  const lowerName = toolName.toLowerCase();
  if (!lowerName.startsWith('mcp__')) return false;
  const nameLooksHttp =
    lowerName.includes('http') ||
    lowerName.includes('fetch') ||
    lowerName.includes('request') ||
    lowerName.includes('web');
  if (!nameLooksHttp) return false;
  return Boolean(httpTargetFor(toolInput)) ||
    Boolean(firstString(toolInput.method, toolInput.http_method, toolInput.httpMethod));
}

function assistantContentFromPayload(payload: unknown): string | undefined {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  for (const key of ['content', 'text', 'summary', 'body']) {
    const text = textFromContent(record[key]);
    if (text) return text;
  }
  const message = record.message;
  if (message && typeof message === 'object') {
    const text = textFromContent((message as Record<string, unknown>).content);
    if (text) return text;
  }
  if (Array.isArray(record.messages)) {
    const latestAssistant = [...record.messages]
      .reverse()
      .find(
        (message): message is Record<string, unknown> =>
          Boolean(message) &&
          typeof message === 'object' &&
          ['assistant', 'ai'].includes(
            String(
              (message as Record<string, unknown>).role ??
                (message as Record<string, unknown>).type ??
                '',
            ),
          ),
      );
    const text = textFromContent(latestAssistant?.content);
    if (text) return text;
  }
  return undefined;
}

function hasToolCallsFromPayload(payload: unknown): boolean {
  return hasToolCallBlocks(recordFrom(payload));
}

function toolCallsFromPayload(payload: unknown): Array<{
  name: string;
  args: Record<string, unknown>;
  raw: unknown;
}> {
  return toolCallRecords(recordFrom(payload)).map((record) => {
    const functionRecord = recordFrom(record.function);
    const rawArgs = record.args ?? record.arguments ?? functionRecord.arguments;
    const args =
      typeof rawArgs === 'string' ? recordFromJson(rawArgs) : recordFrom(rawArgs);
    return {
      name:
        firstString(record.name, functionRecord.name, record.toolName, record.tool_name) ??
        'tool_call',
      args,
      raw: record,
    };
  });
}

function toolCallRecords(record: Record<string, unknown>): Record<string, unknown>[] {
  const direct = [
    ...arrayRecords(record.tool_calls),
    ...arrayRecords(record.toolCalls),
  ];
  const additional = recordFrom(record.additional_kwargs ?? record.additionalKwargs);
  const nested = [
    ...arrayRecords(additional.tool_calls),
    ...arrayRecords(additional.toolCalls),
  ];
  const message = recordFrom(record.message);
  const messageCalls = Object.keys(message).length > 0 ? toolCallRecords(message) : [];
  const messageListCalls = Array.isArray(record.messages)
    ? record.messages.flatMap((entry) => toolCallRecords(recordFrom(entry)))
    : [];
  return [...direct, ...nested, ...messageCalls, ...messageListCalls];
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(recordFrom).filter((record) => Object.keys(record).length > 0) : [];
}

function recordFromJson(value: string): Record<string, unknown> {
  try {
    return recordFrom(JSON.parse(value));
  } catch {
    return {};
  }
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
  const message = recordFrom(record.message);
  if (Object.keys(message).length > 0 && hasToolCallBlocks(message)) return true;
  if (Array.isArray(record.messages)) {
    return record.messages.some((entry) => hasToolCallBlocks(recordFrom(entry)));
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
