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
  buildSpan,
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
// Local fail-CLOSED safety backstop for the approval poll. Expiry stays
// server-authoritative (Core owns the decision and the real expiry, avoiding
// clock-skew false-blocks), but a Core outage or an approval that never resolves
// must not poll forever — so after this generous window we fail closed (block)
// rather than hang the action. Default 30 min, comfortably longer than any real
// human approval; tunable per-deployment via OPENBOX_APPROVAL_POLL_MAX_MS. Read
// at call time (not module load) so deployments — and tests — can override it.
const DEFAULT_APPROVAL_POLL_MAX_MS = 1_800_000;
function approvalPollMaxMs(): number {
  return Number(process.env.OPENBOX_APPROVAL_POLL_MAX_MS) || DEFAULT_APPROVAL_POLL_MAX_MS;
}
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
  const startedAt = Date.now();
  const maxDurationMs = approvalPollMaxMs();
  while (true) {
    // Fail-closed backstop: bound the otherwise-unbounded poll loop (a Core
    // outage `continue`s below; require_approval/constrain keep polling). After
    // the max window with no decision, block rather than hang indefinitely.
    if (Date.now() - startedAt > maxDurationMs) {
      return {
        arm: 'block',
        reason:
          last?.reason ??
          'OpenBox approval timed out (no decision within the poll window).',
        riskScore: 0,
      };
    }
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
    // Canonical hitl.py:88 — REQUIRE_APPROVAL and CONSTRAIN are both "still
    // pending"; keep polling. Only ALLOW or a stop verdict (block/halt) terminates.
    if (last && last.arm !== 'require_approval' && last.arm !== 'constrain') {
      return last;
    }
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
  // Canonical seal: a governance STOP (block/halt) closes the session with
  // WorkflowCompleted(status="failed"), mirroring the Python handler
  // (langgraph_handler._pre_screen_input L573-588), which seals a governed
  // block with WorkflowCompleted+failed rather than WorkflowFailed. WorkflowFailed
  // stays reserved for genuine runtime crashes (see failWorkflow).
  const reason = verdict.reason;
  await bestEffortTerminalEvent(() =>
    createWorkflowSession(
      adapter,
      ids,
      workflowType,
      taskQueue,
    ).workflowCompleted({
      status: 'failed',
      error: typeof reason === 'string' ? new Error(reason) : reason,
    }),
  );
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
          // goal_prompt/original_goal both carry the session goal anchor (the
          // first prompt). Core does NOT detect drift by diffing these fields —
          // drift is decided by Core's LlamaFirewall alignment scoring of this
          // signal against subsequent actions vs. the agent's threshold — so
          // these stay the anchor, matching the goal-signal conformance spec.
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

// Real operation spans (file_read / database_select) emitted alongside the
// tool-call span so platform behavioral rules that trigger on those semantic
// types fire. semantic_type is left for the backend to compute from the span
// shape (buildSpan strips the server-computed field). Started and completed
// share a deterministic span_id/trace_id derived from the activity id so the
// platform pairs them into a single span instead of an orphaned started event.
export function fileReadSpan(
  filePath: string,
  stage: 'started' | 'completed',
  activityId: string,
): SpanData {
  const span = buildSpan('copilotkit', 'file_read', {
    file_path: filePath,
    stage,
  }) as unknown as SpanData;
  const seed = createHash('sha256')
    .update(`openbox.op.file_read:${activityId}`)
    .digest('hex');
  return {
    ...span,
    span_id: seed.slice(0, 16),
    trace_id: seed.slice(0, 32),
  };
}

export function databaseSelectSpan(
  statement: string,
  stage: 'started' | 'completed',
  activityId: string,
): SpanData {
  const span = buildSpan('copilotkit', 'db', {
    db_operation: 'select',
    db_statement: statement,
    stage,
  }) as unknown as SpanData;
  const seed = createHash('sha256')
    .update(`openbox.op.db_select:${activityId}`)
    .digest('hex');
  return {
    ...span,
    span_id: seed.slice(0, 16),
    trace_id: seed.slice(0, 32),
  };
}

// Note: the tool-ACTIVITY span (`toolSpan`) and per-action `spanProfile` were
// removed. Canonical alignment: a tool activity carries no span of its own; only
// the tool's real sub-operations (file/db/http/function) are spanned, and those
// are captured automatically inside governed-tool execution (see otel-capture).
