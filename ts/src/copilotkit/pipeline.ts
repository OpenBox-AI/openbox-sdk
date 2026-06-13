import { randomBytes, randomUUID } from 'node:crypto';
import type { SpanData } from '../core-client/core-client.js';
import type { WorkflowVerdict } from '../core-client/index.js';
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
  emitUserPromptSignal,
  ensureWorkflowStarted,
  failWorkflow,
  finishStoppedWorkflow,
} from './workflow-session.js';

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
  return session.activity(
    completed ? 'ActivityCompleted' : 'ActivityStarted',
    activityType,
    completed
      ? {
          activityId: ids.activityId,
          output: input.payload,
          spans: [pipelineSpan(input.kind, activityType, input.payload)],
        }
      : {
          activityId: ids.activityId,
          input: [input.payload],
          spans: [pipelineSpan(input.kind, activityType, input.payload)],
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
    const safe = isAllowed(verdict.arm)
      ? applyOpenBoxTransform(input.payload, verdict)
      : input.payload;
    const changed = !sameJson(safe, input.payload);
    const payload = safePayload(safe, input.payload, verdict, ids, changed);
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

function pipelineSpan(
  kind: OpenBoxCopilotGateKind,
  activityType: string,
  payload: unknown,
): SpanData {
  const now = Date.now();
  return {
    span_id: randomBytes(8).toString('hex'),
    trace_id: randomBytes(16).toString('hex'),
    name: activityType,
    kind: 'internal',
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
}
