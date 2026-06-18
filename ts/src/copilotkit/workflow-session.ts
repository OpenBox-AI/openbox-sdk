import { randomBytes, randomUUID } from 'node:crypto';
import {
  type OpenBoxCoreClient,
  type SpanData,
} from '../core-client/core-client.js';
import {
  presets,
  type BaseGovernedSession,
  type WorkflowVerdict,
} from '../core-client/index.js';
import { withOpenBoxActivityMetadata } from '../governance/spans.js';
import { errorMessage, nowUnixNano } from './internal-utils.js';
import { mapGuardrailsResult, normalizeArm } from './results.js';
import type {
  GovernedCopilotToolDefinition,
  OpenBoxCopilotActionInput,
  OpenBoxCopilotKitAdapter,
} from './types.js';

const startedWorkflowRuns = new Set<string>();
const TERMINAL_EVENT_TIMEOUT_MS = 5_000;
const APPROVAL_POLL_INTERVAL_MS = 750;
const APPROVAL_MISSING_EXPIRATION_MAX_WAIT_MS = 60_000;

// One user task should map to one OpenBox session. The runtime gate (or the
// middleware, when no runtime gate exists) opens the workflow and registers
// it here so the LangChain middleware and governed tools running in the same
// process can attach their activities to it instead of opening their own.
export interface ActiveWorkflowEntry {
  workflowId: string;
  runId: string;
  /** True when this process opened the workflow and owns its terminal event. */
  owned: boolean;
}

const activeWorkflows = new WeakMap<object, Map<string, ActiveWorkflowEntry>>();
const LAST_WORKFLOW_KEY = '__openbox_last_workflow__';

export function registerActiveWorkflow(
  adapter: OpenBoxCopilotKitAdapter,
  sessionKey: string,
  entry: ActiveWorkflowEntry,
) {
  let map = activeWorkflows.get(adapter);
  if (!map) {
    map = new Map();
    activeWorkflows.set(adapter, map);
  }
  map.set(sessionKey, entry);
  map.set(LAST_WORKFLOW_KEY, entry);
}

export function activeWorkflowFor(
  adapter: OpenBoxCopilotKitAdapter,
  sessionKey: string,
): ActiveWorkflowEntry | undefined {
  const map = activeWorkflows.get(adapter);
  return map?.get(sessionKey) ?? map?.get(LAST_WORKFLOW_KEY);
}

export function clearActiveWorkflow(
  adapter: OpenBoxCopilotKitAdapter,
  sessionKey: string,
  workflowId?: string,
) {
  const map = activeWorkflows.get(adapter);
  if (!map) return;
  const entry = map.get(sessionKey);
  if (!workflowId || entry?.workflowId === workflowId) map.delete(sessionKey);
  const last = map.get(LAST_WORKFLOW_KEY);
  if (last && (!workflowId || last.workflowId === workflowId)) {
    map.delete(LAST_WORKFLOW_KEY);
  }
}

export function clearAllActiveWorkflows(adapter: OpenBoxCopilotKitAdapter) {
  activeWorkflows.get(adapter)?.clear();
}

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
  options: { attached?: boolean; inlineApproval?: boolean } = {},
): BaseGovernedSession {
  return new presets.langchain({
    core: adapter.getCoreClient(),
    workflowId: ids.workflowId,
    runId: ids.runId,
    workflowType,
    taskQueue,
    registerExitHandlers: false,
    attached: options.attached,
    inlineApproval: options.inlineApproval,
  });
}

export async function pollApproval(
  adapter: OpenBoxCopilotKitAdapter,
  ids: { workflowId: string; runId: string; activityId: string },
): Promise<WorkflowVerdict> {
  const fallbackDeadline = Date.now() + APPROVAL_MISSING_EXPIRATION_MAX_WAIT_MS;
  let deadline = Number.POSITIVE_INFINITY;
  let last: WorkflowVerdict | undefined;
  while (Date.now() < deadline) {
    let response: Awaited<ReturnType<OpenBoxCoreClient['pollApproval']>> | undefined;
    try {
      response = await adapter.getCoreClient().pollApproval({
        workflow_id: ids.workflowId,
        run_id: ids.runId,
        activity_id: ids.activityId,
      });
    } catch {
      deadline = Math.min(deadline, fallbackDeadline);
      const sleepMs = Math.min(APPROVAL_POLL_INTERVAL_MS, deadline - Date.now());
      if (sleepMs <= 0) break;
      await sleep(sleepMs);
      continue;
    }
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
    const serverDeadline = parseApprovalDeadline(response.approval_expiration_time);
    deadline = Number.isFinite(serverDeadline)
      ? Math.min(deadline, serverDeadline)
      : Math.min(deadline, fallbackDeadline);
    if (last && last.arm !== 'require_approval') return last;
    const sleepMs = Math.min(APPROVAL_POLL_INTERVAL_MS, deadline - Date.now());
    if (sleepMs <= 0) break;
    await sleep(sleepMs);
  }
  return (
    last ?? {
      arm: 'require_approval',
      reason: 'OpenBox approval is still pending.',
      riskScore: 0,
    }
  );
}

function parseApprovalDeadline(value: string | undefined): number {
  if (!value) return Number.NaN;
  const deadline = new Date(value).getTime();
  return Number.isFinite(deadline) ? deadline : Number.NaN;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function completeWorkflow(
  adapter: OpenBoxCopilotKitAdapter,
  ids: { workflowId: string; runId: string },
  workflowType: string,
  taskQueue: string,
): Promise<WorkflowVerdict | undefined> {
  return bestEffortTerminalEvent(() =>
    createWorkflowSession(
      adapter,
      ids,
      workflowType,
      taskQueue,
    ).workflowCompleted(),
  );
}

export async function finishStoppedWorkflow(
  adapter: OpenBoxCopilotKitAdapter,
  ids: { workflowId: string; runId: string },
  workflowType: string,
  taskQueue: string,
  verdict: WorkflowVerdict,
) {
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

export async function emitUserPromptSignal(
  adapter: OpenBoxCopilotKitAdapter,
  ids: { workflowId: string; runId: string },
  workflowType: string,
  taskQueue: string,
  prompt: string | undefined,
) {
  const signalArgs = prompt?.trim();
  if (!signalArgs) return;

  await createWorkflowSession(adapter, ids, workflowType, taskQueue, {
    attached: true,
  }).activity('SignalReceived', 'user_prompt', {
    signalName: 'user_prompt',
    signalArgs,
  });
}

export async function emitActivityHookSpanUpdate(
  adapter: OpenBoxCopilotKitAdapter,
  ids: { workflowId: string; runId: string; activityId: string },
  workflowType: string,
  taskQueue: string,
  activityType: string | undefined,
  output: unknown,
  spans: SpanData[],
): Promise<WorkflowVerdict> {
  return createWorkflowSession(adapter, ids, workflowType, taskQueue, {
    attached: true,
  }).activity('ActivityCompleted', activityType ?? 'assistant_output', {
    activityId: ids.activityId,
    output,
    spans,
  });
}

export async function failWorkflow(
  adapter: OpenBoxCopilotKitAdapter,
  ids: { workflowId: string; runId: string },
  workflowType: string,
  taskQueue: string,
  reason: unknown,
): Promise<WorkflowVerdict | undefined> {
  return bestEffortTerminalEvent(() =>
    createWorkflowSession(
      adapter,
      ids,
      workflowType,
      taskQueue,
    ).workflowFailed(typeof reason === 'string' ? new Error(reason) : reason),
  );
}

async function bestEffortTerminalEvent(
  fn: () => Promise<WorkflowVerdict | undefined>,
): Promise<WorkflowVerdict | undefined> {
  const terminalEvent = fn().catch(() => undefined);
  try {
    return await Promise.race<WorkflowVerdict | undefined>([
      terminalEvent,
      new Promise<undefined>((resolve) =>
        setTimeout(() => resolve(undefined), TERMINAL_EVENT_TIMEOUT_MS),
      ),
    ]);
  } catch {
    return undefined;
  }
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

export function toolActivityInput<TInput extends OpenBoxCopilotActionInput, TArtifact>(
  definition: GovernedCopilotToolDefinition<TInput, TArtifact>,
  input: TInput,
): unknown[] {
  return withCopilotToolActivityMetadata([toolInput(definition, input)]);
}

export function withCopilotToolActivityMetadata(input: unknown[]): unknown[] {
  return withOpenBoxActivityMetadata(input, {
    toolType: 'llm_tool_call',
  });
}

export function toolSpan<TInput extends OpenBoxCopilotActionInput, TArtifact>(
  definition: GovernedCopilotToolDefinition<TInput, TArtifact>,
  input: TInput,
  stage: 'started' | 'completed',
): SpanData {
  const now = nowUnixNano();
  const profile = definition.spanProfile?.(input, stage);
  const base = {
    span_id: randomBytes(8).toString('hex'),
    trace_id: randomBytes(16).toString('hex'),
    name: definition.toolName,
    kind: 'tool',
    span_type: 'function',
    start_time: now,
    end_time: now,
    duration_ns: 0,
    stage,
    semantic_type: 'llm_tool_call',
    attributes: {
      'openbox.semantic_type': 'llm_tool_call',
      'openbox.span_type': 'function',
      'openbox.tool.name': definition.toolName,
      'openbox.action': input.action,
      'tool.name': definition.toolName,
      tool_name: definition.toolName,
    },
    data: input,
  } as SpanData;
  if (!profile) return base;
  return {
    ...base,
    ...profile,
    attributes: {
      ...base.attributes,
      ...(profile.attributes ?? {}),
    },
    data: profile.data ?? base.data,
  } as SpanData;
}
