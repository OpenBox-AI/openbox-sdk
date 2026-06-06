import { randomBytes, randomUUID } from 'node:crypto';
import type {
  GovernanceEventPayload,
  SpanData,
} from '../core-client/core-client.js';
import type { WorkflowVerdict } from '../core-client/index.js';
import { errorMessage, sameJson } from './internal-utils.js';
import { applyOpenBoxTransform, isAllowed, safePayload } from './results.js';
import type {
  OpenBoxCopilotGateInput,
  OpenBoxCopilotGateKind,
  OpenBoxCopilotKitAdapter,
  OpenBoxCopilotSessionState,
  OpenBoxSafePayload,
} from './types.js';
import {
  activityEvent,
  ensureWorkflowStarted,
  evaluate,
} from './workflow-session.js';

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
  const ids = {
    workflowId: input.workflowId ?? randomUUID(),
    runId: input.runId ?? randomUUID(),
    activityId: input.activityId ?? randomUUID(),
  };
  const key = input.sessionKey ?? 'default';
  const halted = input.haltedSessions.get(key);
  if (halted) {
    const verdict: WorkflowVerdict = {
      arm: 'halt',
      reason: halted.reason,
      riskScore: 0,
    };
    return {
      safe: input.payload,
      verdict,
      status: 'session_halted',
      changed: false,
      rawBlocked: true,
      reason: halted.reason,
      message: halted.reason,
      workflowId: ids.workflowId,
      runId: ids.runId,
      activityId: ids.activityId,
      session: halted,
    };
  }
  if (!adapter.isEnabled()) {
    const verdict: WorkflowVerdict = {
      arm: 'allow',
      reason: 'OpenBox disabled for local development.',
      riskScore: 0,
    };
    return safePayload(input.payload, input.payload, verdict, ids, false);
  }
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
    const verdict = await evaluate(adapter, gateEvent(input, ids));
    const safe = isAllowed(verdict.arm)
      ? applyOpenBoxTransform(input.payload, verdict)
      : input.payload;
    const changed = !sameJson(safe, input.payload);
    const payload = safePayload(safe, input.payload, verdict, ids, changed);
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
    const verdict: WorkflowVerdict = {
      arm: 'block',
      reason: errorMessage(error),
      riskScore: 0,
    };
    return safePayload(input.payload, input.payload, verdict, ids, false);
  }
}

function gateEvent<T>(
  input: OpenBoxCopilotGateInput<T> & {
    kind: OpenBoxCopilotGateKind;
    workflowType: string;
    taskQueue: string;
  },
  ids: { workflowId: string; runId: string; activityId: string },
): GovernanceEventPayload {
  const completed =
    input.kind === 'tool_output' || input.kind === 'assistant_output';
  const activityType = input.activityType ?? activityTypeForGate(input.kind);
  return activityEvent(
    completed ? 'ActivityCompleted' : 'ActivityStarted',
    ids,
    input.workflowType,
    input.taskQueue,
    completed
      ? {
          activity_type: activityType,
          activity_output: input.payload,
          spans: [pipelineSpan(input.kind, activityType, input.payload)],
        }
      : {
          activity_type: activityType,
          activity_input: [input.payload],
          spans: [pipelineSpan(input.kind, activityType, input.payload)],
        },
  );
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
