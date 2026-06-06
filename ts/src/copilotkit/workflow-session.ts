import { randomBytes, randomUUID } from 'node:crypto';
import {
  type GovernanceEventPayload,
  type SpanData,
} from '../core-client/core-client.js';
import {
  presets,
  type BaseGovernedSession,
  type WorkflowVerdict,
} from '../core-client/index.js';
import { errorMessage, swallow } from './internal-utils.js';
import { mapGuardrailsResult, normalizeArm } from './results.js';
import type {
  GovernedCopilotToolDefinition,
  OpenBoxCopilotActionInput,
  OpenBoxCopilotKitAdapter,
} from './types.js';

const startedWorkflowRuns = new Set<string>();

export function createWorkflowIds() {
  return {
    workflowId: randomUUID(),
    runId: randomUUID(),
    activityId: randomUUID(),
  };
}

export function createWorkflowSession(
  adapter: OpenBoxCopilotKitAdapter,
  ids: { workflowId: string; runId: string },
  workflowType: string,
  taskQueue: string,
): BaseGovernedSession {
  return new presets.langchain({
    core: adapter.getCoreClient(),
    workflowId: ids.workflowId,
    runId: ids.runId,
    workflowType,
    taskQueue,
    registerExitHandlers: false,
  });
}

export function agentSessionForState(
  adapter: OpenBoxCopilotKitAdapter,
  state: Record<string, unknown> | undefined,
  workflowType: string,
  taskQueue: string,
): BaseGovernedSession {
  return createWorkflowSession(
    adapter,
    {
      workflowId:
        typeof state?.openboxWorkflowId === 'string'
          ? state.openboxWorkflowId
          : randomUUID(),
      runId:
        typeof state?.openboxRunId === 'string'
          ? state.openboxRunId
          : randomUUID(),
    },
    workflowType,
    taskQueue,
  );
}

export async function evaluate(
  adapter: OpenBoxCopilotKitAdapter,
  payload: GovernanceEventPayload,
): Promise<WorkflowVerdict> {
  const response = await adapter.getCoreClient().evaluate(payload);
  return {
    arm: normalizeArm(response.verdict || response.action),
    approvalId: response.approval_id,
    governanceEventId: response.governance_event_id,
    approvalExpiresAt: response.approval_expiration_time,
    reason: response.reason,
    riskScore: response.risk_score ?? 0,
    trustTier: response.trust_tier,
    guardrailsResult: mapGuardrailsResult(response.guardrails_result),
  };
}

export async function pollApproval(
  adapter: OpenBoxCopilotKitAdapter,
  ids: { workflowId: string; runId: string; activityId: string },
): Promise<WorkflowVerdict> {
  const deadline = Date.now() + 10_000;
  let last: WorkflowVerdict | undefined;
  while (Date.now() < deadline) {
    const response = await adapter.getCoreClient().pollApproval({
      workflow_id: ids.workflowId,
      run_id: ids.runId,
      activity_id: ids.activityId,
    });
    const extra = response as typeof response & {
      trust_tier?: string | number;
      guardrails_result?: unknown;
    };
    last = {
      arm: normalizeArm(response.action),
      reason: response.reason,
      approvalExpiresAt: response.approval_expiration_time,
      riskScore: 0,
      trustTier:
        typeof extra.trust_tier === 'number' ? extra.trust_tier : undefined,
      guardrailsResult: mapGuardrailsResult(extra.guardrails_result),
    };
    if (last && last.arm !== 'require_approval') return last;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return (
    last ?? {
      arm: 'require_approval',
      reason: 'OpenBox approval is still pending.',
      riskScore: 0,
    }
  );
}

export async function completeWorkflow(
  adapter: OpenBoxCopilotKitAdapter,
  ids: { workflowId: string; runId: string },
  workflowType: string,
  taskQueue: string,
) {
  await createWorkflowSession(
    adapter,
    ids,
    workflowType,
    taskQueue,
  ).workflowCompleted();
}

export async function finishStoppedWorkflow(
  adapter: OpenBoxCopilotKitAdapter,
  ids: { workflowId: string; runId: string },
  workflowType: string,
  taskQueue: string,
  verdict: WorkflowVerdict,
) {
  if (verdict.arm === 'halt') {
    await completeWorkflow(adapter, ids, workflowType, taskQueue);
    return;
  }
  await failWorkflow(adapter, ids, workflowType, taskQueue, verdict.reason);
}

export async function ensureWorkflowStarted(
  adapter: OpenBoxCopilotKitAdapter,
  ids: { workflowId: string; runId: string },
  workflowType: string,
  taskQueue: string,
) {
  const key = `${ids.workflowId}:${ids.runId}`;
  if (startedWorkflowRuns.has(key)) {
    return;
  }
  startedWorkflowRuns.add(key);
  try {
    await createWorkflowSession(
      adapter,
      ids,
      workflowType,
      taskQueue,
    ).workflowStarted();
  } catch (error) {
    const message = errorMessage(error);
    if (
      message.includes('UQ_SESSIONS_WORKFLOW_RUN') ||
      message.includes('duplicate key value violates unique constraint')
    ) {
      return;
    }
    startedWorkflowRuns.delete(key);
    throw error;
  }
}

export async function failWorkflow(
  adapter: OpenBoxCopilotKitAdapter,
  ids: { workflowId: string; runId: string },
  workflowType: string,
  taskQueue: string,
  reason: unknown,
) {
  await swallow(() =>
    createWorkflowSession(adapter, ids, workflowType, taskQueue).workflowFailed(
      typeof reason === 'string' ? new Error(reason) : reason,
    ),
  );
}

export function activityEvent(
  eventType: 'ActivityStarted' | 'ActivityCompleted',
  ids: { workflowId: string; runId: string; activityId: string },
  workflowType: string,
  taskQueue: string,
  extra: Partial<GovernanceEventPayload>,
): GovernanceEventPayload {
  return {
    source: 'langgraph',
    event_type: eventType,
    workflow_id: ids.workflowId,
    run_id: ids.runId,
    workflow_type: workflowType,
    task_queue: taskQueue as GovernanceEventPayload['task_queue'],
    timestamp: new Date().toISOString(),
    activity_id: ids.activityId,
    activity_type:
      eventType === 'ActivityStarted' ? 'on_tool_start' : 'on_tool_end',
    ...extra,
  };
}

export function toolInput<TInput extends OpenBoxCopilotActionInput, TArtifact>(
  definition: GovernedCopilotToolDefinition<TInput, TArtifact>,
  input: TInput,
) {
  return {
    id: undefined,
    name: definition.toolName,
    args: input,
    description: definition.description,
  };
}

export function toolSpan<TInput extends OpenBoxCopilotActionInput, TArtifact>(
  definition: GovernedCopilotToolDefinition<TInput, TArtifact>,
  input: TInput,
  stage: 'started' | 'completed',
): SpanData {
  const now = Date.now();
  return {
    span_id: randomBytes(8).toString('hex'),
    trace_id: randomBytes(16).toString('hex'),
    name: definition.toolName,
    kind: 'tool',
    start_time: now,
    end_time: now,
    duration_ns: 0,
    stage,
    attributes: {
      'openbox.tool.name': definition.toolName,
      'openbox.action': input.action,
      'tool.name': definition.toolName,
    },
    data: input,
  } as SpanData;
}
