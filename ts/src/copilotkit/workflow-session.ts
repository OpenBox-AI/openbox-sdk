import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  type OpenBoxCoreClient,
  type SpanData,
} from '../core-client/core-client.js';
import { stampSource } from '../approvals/source.js';
import {
  PRESET_ACTIVITY_TYPES,
  presets,
  type LangchainSession,
  type WorkflowVerdict,
} from '../core-client/index.js';
import { EVENT } from '../governance/events.js';
import {
  stripServerComputedSemantic,
  withOpenBoxActivityMetadata,
} from '../governance/spans.js';
import { errorMessage, nowUnixNano } from './internal-utils.js';
import {
  effectiveArmForGuardrails,
  guardrailFailureReason,
  mapGuardrailsResult,
  normalizeArm,
} from './results.js';
import type {
  GovernedCopilotToolDefinition,
  OpenBoxCopilotActionInput,
  OpenBoxCopilotKitAdapter,
} from './types.js';

const startedWorkflowRuns = new Set<string>();
const TERMINAL_EVENT_TIMEOUT_MS = 5_000;
const APPROVAL_POLL_INTERVAL_MS = 750;
const defaultActivity = PRESET_ACTIVITY_TYPES.default;
const langchainActivity = PRESET_ACTIVITY_TYPES.langchain;

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
const sessionGoals = new WeakMap<object, Map<string, string>>();
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
): LangchainSession {
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
  let last: WorkflowVerdict | undefined;
  while (true) {
    let response: Awaited<ReturnType<OpenBoxCoreClient['pollApproval']>> | undefined;
    try {
      response = await adapter.getCoreClient().pollApproval({
        workflow_id: ids.workflowId,
        run_id: ids.runId,
        activity_id: ids.activityId,
      });
    } catch {
      await sleep(APPROVAL_POLL_INTERVAL_MS);
      continue;
    }
    const extra = response as typeof response & {
      expired?: boolean;
      trust_tier?: string | number;
      trustTier?: string | number;
      guardrails_result?: unknown;
      guardrailsResult?: unknown;
      verdict?: unknown;
      approvalExpiresAt?: string;
    };
    const approvalExpiresAt =
      response.approval_expiration_time ?? extra.approvalExpiresAt;
    const rawTrustTier = extra.trust_tier ?? extra.trustTier;
    const trustTier = typeof rawTrustTier === 'number' ? rawTrustTier : undefined;
    const guardrailsPayload = extra.guardrails_result ?? extra.guardrailsResult;
    if (extra.expired === true) {
      return {
        arm: 'block',
        reason: response.reason ?? 'OpenBox approval expired.',
        approvalExpiresAt,
        riskScore: 0,
        trustTier,
        guardrailsResult: mapGuardrailsResult(guardrailsPayload),
      };
    }
    const guardrailsResult = mapGuardrailsResult(guardrailsPayload);
    const arm = effectiveArmForGuardrails(
      normalizeArm(extra.verdict ?? response.action),
      guardrailsResult,
    );
    last = {
      arm,
      reason: response.reason,
      approvalExpiresAt,
      riskScore: 0,
      trustTier,
      guardrailsResult,
    };
    if (guardrailsResult?.validationPassed === false && !response.reason) {
      last.reason = guardrailFailureReason(guardrailsResult);
    }
    if (last && last.arm !== 'require_approval') return last;
    await sleep(APPROVAL_POLL_INTERVAL_MS);
  }
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
  sessionId?: string,
) {
  const currentPrompt = prompt?.trim();
  if (!currentPrompt) return;
  const goalKey =
    sessionId && sessionId !== 'default'
      ? `session:${sessionId}`
      : `workflow:${ids.workflowId}:${ids.runId}`;
  let goals = sessionGoals.get(adapter);
  if (!goals) {
    goals = new Map();
    sessionGoals.set(adapter, goals);
  }
  const existingGoal = goals.get(goalKey);
  const goalPrompt = existingGoal ?? currentPrompt;
  const isInitialGoal = existingGoal === undefined;
  goals.set(goalKey, goalPrompt);
  const signalArgs = [currentPrompt];

  await createWorkflowSession(adapter, ids, workflowType, taskQueue, {
    attached: true,
  }).activity(EVENT.SIGNAL, defaultActivity.goalSignal, {
    input: [
      stampSource(
        {
          prompt: currentPrompt,
          current_prompt: currentPrompt,
          goal_prompt: goalPrompt,
          original_goal: goalPrompt,
          event_category: 'agent_goal',
          is_initial_goal: isInitialGoal,
        },
        'copilotkit',
      ),
    ],
    signalName: defaultActivity.goalSignal,
    signalArgs,
    sessionId,
    prompt: currentPrompt,
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
  }).activity(EVENT.COMPLETE, activityType ?? langchainActivity.onLlmEnd, {
    activityId: ids.activityId,
    output,
    spans,
    hookSpanParentEventType: EVENT.START,
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
  _definition: GovernedCopilotToolDefinition<TInput, TArtifact>,
  input: TInput,
): unknown[] {
  return withCopilotToolActivityMetadata([{ id: undefined, args: input }]);
}

export function withCopilotToolActivityMetadata(input: unknown[]): unknown[] {
  return withOpenBoxActivityMetadata(input, {
    toolType: 'llm_tool_call',
  });
}

// Started and completed hook spans for the same activity must share a span
// identity so the OpenBox platform pairs them into a single span (a started
// event with its completion) instead of rendering an orphaned started span.
// Derive the identity deterministically from the activity id so the started
// gate and the completed gate compute the same span_id/trace_id without
// sharing in-process state. Seeds differ from the parent-span seed so the
// span_id never collides with the parent_span_id.
export function spanIdentityFromActivity(activityId: string): {
  span_id: string;
  trace_id: string;
} {
  return {
    span_id: createHash('sha256')
      .update(`openbox.span:${activityId}`)
      .digest('hex')
      .slice(0, 16),
    trace_id: createHash('sha256')
      .update(`openbox.trace:${activityId}`)
      .digest('hex')
      .slice(0, 32),
  };
}

export function withSpanIdentityFromActivity<T extends object>(
  span: T,
  activityId: string | undefined,
): T {
  if (!activityId) return span;
  return { ...span, ...spanIdentityFromActivity(activityId) };
}

export function toolSpan<TInput extends OpenBoxCopilotActionInput, TArtifact>(
  definition: GovernedCopilotToolDefinition<TInput, TArtifact>,
  input: TInput,
  stage: 'started' | 'completed',
  output?: unknown,
  activityId?: string,
  startTimeNs?: number,
): SpanData {
  const now = nowUnixNano();
  // Real timing when the caller threads the started timestamp: the completed
  // span's duration_ns is end-start instead of a hardcoded 0.
  const startTime = startTimeNs ?? now;
  const profile = definition.spanProfile?.(input, stage);
  const requestBody = stringifySpanBody({
    tool_choice: definition.toolName,
    tool_input: input,
  });
  const responseBody =
    stage === 'completed'
      ? stringifySpanBody(output ?? { tool_calls: [{ name: definition.toolName, arguments: input }] })
      : null;
  const base = {
    span_id: randomBytes(8).toString('hex'),
    trace_id: randomBytes(16).toString('hex'),
    name: definition.toolName,
    kind: 'tool',
    // Matches the langgraph-py/Temporal reference: function-call operations are
    // span_type 'internal' (+ hook_type 'function_call'), never 'function'.
    span_type: 'internal',
    hook_type: 'function_call',
    start_time: startTime,
    end_time: stage === 'completed' ? now : null,
    duration_ns:
      stage === 'completed' ? Math.max(0, now - startTime) : null,
    stage,
    status: { code: 'UNSET' },
    events: [],
    attributes: {
      'openbox.span_type': 'internal',
      'openbox.tool.name': definition.toolName,
      'openbox.action': input.action,
      'tool.name': definition.toolName,
      tool_name: definition.toolName,
    },
    data: input,
    args: input,
    result: output ?? null,
    request_body: requestBody,
    response_body: responseBody,
  } as SpanData;
  if (!profile) {
    return withSpanIdentityFromActivity(
      stripServerComputedSemantic(base),
      activityId,
    );
  }
  const profileRecord = profile as Record<string, unknown>;
  return withSpanIdentityFromActivity(
    stripServerComputedSemantic({
      ...base,
      ...profile,
      attributes: {
        ...base.attributes,
        ...(profile.attributes ?? {}),
      },
      data: profile.data ?? base.data,
      request_body: profileRecord.request_body ?? base.request_body,
      response_body: profileRecord.response_body ?? base.response_body,
    } as SpanData),
    activityId,
  );
}

function stringifySpanBody(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ value: String(value) });
  }
}
