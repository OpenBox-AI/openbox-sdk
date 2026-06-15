import { randomBytes, randomUUID } from 'node:crypto';
import type { AGEResult, SpanData } from '../core-client/core-client.js';
import type { WorkflowVerdict } from '../core-client/index.js';
import {
  buildLLMCompletionSpan,
  type LLMTokenUsage,
} from '../governance/spans.js';
import { errorMessage, sameJson, swallow } from './internal-utils.js';
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
  emitActivityHookSpanUpdate,
  emitUserPromptSignal,
  ensureWorkflowStarted,
  failWorkflow,
  finishStoppedWorkflow,
} from './workflow-session.js';

type WorkflowVerdictWithAge = WorkflowVerdict & { ageResult?: AGEResult };

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
  const activityType = input.activityType ?? activityTypeForGate(input.kind);
  const session = gateSession(
    adapter,
    { workflowId: ids.workflowId, runId: ids.runId },
    input.workflowType,
    input.taskQueue,
  );
  const spans = pipelineSpansForGate(input.kind, activityType, input.payload);
  return session.activity(
    completed ? 'ActivityCompleted' : 'ActivityStarted',
    activityType,
    completed
      ? {
          activityId: ids.activityId,
          output: input.payload,
          spans,
        }
      : {
          activityId: ids.activityId,
          input: [input.payload],
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
    governanceMode: 'observe' | 'enforce';
    failClosed: boolean;
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
      await emitUserPromptSignal(
        adapter,
        { workflowId: ids.workflowId, runId: ids.runId },
        input.workflowType,
        input.taskQueue,
        promptTextFromPayload(input.payload),
      );
    }
    const verdict = await evaluateGate(adapter, input, ids);
    const transformed = isAllowed(verdict.arm)
      ? applyOpenBoxTransform(input.payload, verdict)
      : input.payload;
    const effectiveVerdict = isAllowed(verdict.arm)
      ? await evaluateAssistantOutputHook(
          adapter,
          input,
          ids,
          verdict,
          transformed,
        )
      : verdict;
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
    if (!input.failClosed || input.governanceMode === 'observe') {
      const verdict: WorkflowVerdict = {
        arm: 'allow',
        reason: errorMessage(error),
        riskScore: 0,
      };
      return safePayload(input.payload, input.payload, verdict, ids, false);
    }
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
    failClosed: boolean;
    governanceMode: 'observe' | 'enforce';
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
    if (!input.failClosed || input.governanceMode === 'observe') {
      const verdict: WorkflowVerdict = {
        arm: 'allow',
        reason: errorMessage(error),
        riskScore: 0,
      };
      return safePayload(input.payload, input.payload, verdict, ids, false);
    }
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

function activityTypeForGate(kind: OpenBoxCopilotGateKind): string {
  switch (kind) {
    case 'prompt':
      return 'UserPromptSubmit';
    case 'tool_input':
      return 'on_tool_start';
    case 'tool_output':
      return 'on_tool_end';
    case 'assistant_output':
      return 'on_llm_end';
  }
}

async function evaluateAssistantOutputHook<T>(
  adapter: OpenBoxCopilotKitAdapter,
  input: OpenBoxCopilotGateInput<T> & {
    kind: OpenBoxCopilotGateKind;
    workflowType: string;
    taskQueue: string;
  },
  ids: { workflowId: string; runId: string; activityId: string },
  verdict: WorkflowVerdict,
  safePayload: T,
): Promise<WorkflowVerdict> {
  if (input.kind !== 'assistant_output') return verdict;
  const content = assistantContentFromPayload(safePayload);
  if (!content) return verdict;
  const hookVerdict = await emitActivityHookSpanUpdate(
    adapter,
    ids,
    input.workflowType,
    input.taskQueue,
    input.activityType ?? activityTypeForGate(input.kind),
    safePayload,
    [
      buildLLMCompletionSpan({
        content,
        span: pipelineSpan(input.kind, 'llm.chat.completion', safePayload),
        name: 'openbox.copilotkit.assistant_output',
        kind: 'llm',
        system: 'copilotkit',
        attributes: { 'gen_ai.system': 'copilotkit' },
        ...llmCompletionMetadataFromPayload(safePayload),
      }),
    ],
  );
  return mergeGateVerdicts(verdict, hookVerdict);
}

function llmCompletionMetadataFromPayload(payload: unknown): {
  model?: string;
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
  );
  const model =
    firstString(
      record.model,
      record.model_name,
      record.modelName,
      metadata.model,
      metadata.model_name,
      metadata.modelName,
    ) ?? undefined;
  return {
    model,
    usage: usageFrom(usageMetadata),
    requestBody:
      record.request_body ?? record.requestBody ?? metadata.request_body,
    responseBody:
      record.response_body ?? record.responseBody ?? metadata.response_body,
    providerUrl: providerUrlFor(
      firstString(
        metadata.ls_provider,
        metadata.provider,
        record.provider,
        record.model_provider,
      ),
      model,
    ),
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

function usageFrom(record: Record<string, unknown>): LLMTokenUsage | undefined {
  const usage = {
    promptTokens: numberFrom(record.prompt_tokens ?? record.promptTokens),
    completionTokens: numberFrom(
      record.completion_tokens ?? record.completionTokens,
    ),
    inputTokens: numberFrom(record.input_tokens ?? record.inputTokens),
    outputTokens: numberFrom(record.output_tokens ?? record.outputTokens),
    totalTokens: numberFrom(record.total_tokens ?? record.totalTokens),
  };
  return Object.values(usage).some((value) => value !== undefined)
    ? usage
    : undefined;
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

function mergeGateVerdicts(
  first: WorkflowVerdict,
  second: WorkflowVerdict,
): WorkflowVerdict {
  const winner =
    verdictSeverity(second.arm) > verdictSeverity(first.arm) ? second : first;
  const merged = {
    ...winner,
    governanceEventId:
      winner.governanceEventId ??
      first.governanceEventId ??
      second.governanceEventId,
    riskScore: Math.max(first.riskScore ?? 0, second.riskScore ?? 0),
    trustTier: second.trustTier ?? first.trustTier ?? winner.trustTier,
    guardrailsResult:
      winner.guardrailsResult ??
      first.guardrailsResult ??
      second.guardrailsResult,
  } as WorkflowVerdict & Record<string, unknown>;
  const firstAge = (first as WorkflowVerdictWithAge).ageResult;
  const secondAge = (second as WorkflowVerdictWithAge).ageResult;
  if (secondAge ?? firstAge) merged.ageResult = secondAge ?? firstAge;
  return merged;
}

function verdictSeverity(arm: WorkflowVerdict['arm']): number {
  switch (arm) {
    case 'halt':
      return 4;
    case 'block':
      return 3;
    case 'require_approval':
      return 2;
    case 'constrain':
      return 1;
    case 'allow':
      return 0;
  }
}

function pipelineSpansForGate(
  kind: OpenBoxCopilotGateKind,
  activityType: string,
  payload: unknown,
): SpanData[] {
  if (kind === 'assistant_output') return [];
  return [pipelineSpan(kind, activityType, payload)];
}

function pipelineSpan(
  kind: OpenBoxCopilotGateKind,
  activityType: string,
  payload: unknown,
): SpanData {
  const now = Date.now();
  const toolName = toolNameFromPayload(payload) ?? activityType;
  const toolSpan = kind === 'tool_input' || kind === 'tool_output';
  const span = {
    span_id: randomBytes(8).toString('hex'),
    trace_id: randomBytes(16).toString('hex'),
    name: toolSpan ? toolName : activityType,
    kind: toolSpan ? 'tool' : 'internal',
    span_type: 'function',
    start_time: now,
    end_time: now,
    duration_ns: 0,
    stage: kind === 'prompt' || kind === 'tool_input' ? 'started' : 'completed',
    ...(toolSpan ? { semantic_type: 'llm_tool_call' } : {}),
    attributes: {
      'openbox.copilotkit.gate': kind,
      'openbox.activity_type': activityType,
      ...(toolSpan
        ? {
            'openbox.semantic_type': 'llm_tool_call',
            'openbox.span_type': 'function',
            'openbox.tool.name': toolName,
            'tool.name': toolName,
            tool_name: toolName,
          }
        : {}),
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
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  const message = record.message;
  if (message && typeof message === 'object') {
    const content = (message as Record<string, unknown>).content;
    if (typeof content === 'string' && content.trim()) return content;
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
          ) &&
          typeof (message as Record<string, unknown>).content === 'string',
      );
    if (
      typeof latestAssistant?.content === 'string' &&
      latestAssistant.content.trim()
    ) {
      return latestAssistant.content;
    }
  }
  return undefined;
}
