import { randomBytes, randomUUID } from 'node:crypto';
import type { SpanData } from '../core-client/core-client.js';
import type { GovernedPayload, WorkflowVerdict } from '../core-client/index.js';
import { PRESET_ACTIVITY_TYPES } from '../core-client/generated/govern.js';
import { EVENT } from '../governance/events.js';
import {
  llmTokenUsageFromRecord,
  withOpenBoxActivityMetadata,
  type LLMTokenUsage,
  type OpenBoxActivityMetadataInput,
} from '../governance/spans.js';
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
} from './workflow-session.js';

const defaultActivity = PRESET_ACTIVITY_TYPES.default;
const langchainActivity = PRESET_ACTIVITY_TYPES.langchain;

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
  const activityType =
    input.activityType ?? activityTypeForGate(input.kind, input.payload);
  const spans = spansForGate(input.kind, activityType, input.payload);
  const telemetry = telemetryForGate(
    input.kind,
    activityType,
    input.payload,
    input.sessionKey,
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
          ensureHookSpanParent: true,
        }
      : {};
  if (input.kind === 'tool_input') {
    const opened = await session.openActivity(activityType, {
      activityId: ids.activityId,
      input: toolActivityInput(input.payload, activityType),
      ...telemetry,
      spans,
    });
    return opened.verdict;
  }
  return session.activity(
    completed ? EVENT.COMPLETE : EVENT.START,
    activityType,
    completed
      ? {
          activityId: ids.activityId,
          output: input.payload,
          ...telemetry,
          spans,
          ...spanParent,
        }
      : {
          activityId: ids.activityId,
          input: [input.payload],
          ...telemetry,
          spans,
        },
  );
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
    if (needsWorkflowStart) {
      await ensureWorkflowStarted(
        adapter,
        { workflowId: ids.workflowId, runId: ids.runId },
        input.workflowType,
        input.taskQueue,
      );
    }
    workflowKnown = true;
    if (input.kind === 'prompt') {
      if (shouldSkipPromptGate(input.payload, promptText)) {
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
): string {
  switch (kind) {
    case 'prompt':
      return defaultActivity.userPromptSubmit;
    case 'tool_input':
      return toolNameFromPayload(payload) ?? langchainActivity.onToolStart;
    case 'tool_output':
      return toolNameFromPayload(payload) ?? langchainActivity.onToolEnd;
    case 'assistant_output':
      return langchainActivity.onLlmEnd;
  }
}

function llmCompletionMetadataFromPayload(payload: unknown): {
  model?: string;
  provider?: string;
  usage?: LLMTokenUsage;
  requestBody?: unknown;
  responseBody?: unknown;
  providerUrl?: string;
} {
  const record = recordFrom(payload);
  const metadata = firstRecord(
    record.response_metadata,
    record.responseMetadata,
    record.lc_kwargs && recordFrom(record.lc_kwargs).response_metadata,
    record.lc_kwargs && recordFrom(record.lc_kwargs).responseMetadata,
  );
  const usageMetadata = firstRecord(
    record.usage_metadata,
    record.usageMetadata,
    record.usage,
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
    ) ?? undefined;
  const provider = firstString(
    metadata.ls_provider,
    metadata.provider,
    record.provider,
    record.model_provider,
  );
  return {
    model,
    provider,
    usage: llmTokenUsageFromRecord(usageMetadata),
    requestBody:
      record.request_body ?? record.requestBody ?? metadata.request_body,
    responseBody:
      record.response_body ?? record.responseBody ?? metadata.response_body,
    providerUrl: providerUrlFor(provider, model),
  };
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
): Pick<
  GovernedPayload,
  | 'sessionId'
  | 'llmModel'
  | 'inputTokens'
  | 'outputTokens'
  | 'totalTokens'
  | 'prompt'
  | 'completion'
  | 'toolName'
  | 'toolType'
> {
  const sessionId = sessionKey === 'default' ? undefined : sessionKey;
  if (kind === 'prompt') {
    return {
      sessionId,
      prompt: promptTextFromPayload(payload),
    };
  }
  if (kind === 'assistant_output') {
    const metadata = llmCompletionMetadataFromPayload(payload);
    return {
      ...assistantOutputTelemetryFields({
        source: 'copilotkit',
        sessionId,
        content: assistantContentFromPayload(payload),
        model: metadata.model,
        usage: metadata.usage,
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
  return { toolType: 'llm_tool_call' };
}

function spansForGate(
  kind: OpenBoxCopilotGateKind,
  activityType: string,
  payload: unknown,
): SpanData[] {
  switch (kind) {
    case 'assistant_output': {
      const content = assistantContentFromPayload(payload);
      if (!content) return [];
      return buildAssistantOutputSpan({
        source: 'copilotkit',
        content,
        span: pipelineSpan(kind, 'llm.chat.completion', payload),
        name: 'openbox.copilotkit.assistant_output',
        attributes: { 'gen_ai.system': 'copilotkit' },
        hasToolCalls: hasToolCallsFromPayload(payload),
        ...llmCompletionMetadataFromPayload(payload),
      }) ?? [];
    }
    case 'tool_input':
    case 'tool_output':
      return [toolCallSpan(kind, activityType, payload)];
    case 'prompt':
      return [];
  }
}

function toolCallSpan(
  kind: Extract<OpenBoxCopilotGateKind, 'tool_input' | 'tool_output'>,
  activityType: string,
  payload: unknown,
): SpanData {
  const now = nowUnixNano();
  const stage = kind === 'tool_input' ? 'started' : 'completed';
  const toolName = activityType || 'call';
  return {
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
    semantic_type: 'llm_tool_call',
    status: { code: 'UNSET' },
    events: [],
    attributes: {
      'gen_ai.system': 'copilotkit',
      'openbox.copilotkit.gate': kind,
      'openbox.activity_type': activityType,
      'openbox.semantic_type': 'llm_tool_call',
      'openbox.span_type': 'function',
      'openbox.tool.name': toolName,
      'tool.name': toolName,
      tool_name: toolName,
    },
    data: payload,
    ...(stage === 'completed' ? { result: payload } : {}),
  } as SpanData;
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
  if (kind !== 'assistant_output') return span;

  const assistantContent = assistantContentFromPayload(payload);
  if (!assistantContent) return span;
  return {
    ...span,
    name: 'openbox.copilotkit.assistant_output',
    semantic_type: 'llm_completion',
    response_body: JSON.stringify({
      choices: [{ message: { content: assistantContent } }],
    }),
  } as SpanData;
}

function toolNameFromPayload(payload: unknown): string | undefined {
  const record = recordFrom(payload);
  return firstString(
    record.toolName,
    record.tool_name,
    record.name,
    record.action,
    record.actionName,
  );
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
