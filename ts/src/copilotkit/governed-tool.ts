import { randomUUID } from 'node:crypto';
import { DEFAULT_TASK_QUEUE, DEFAULT_WORKFLOW_TYPE } from './constants.js';
import { nowUnixNano, sessionKeyFromConfig } from './internal-utils.js';
import {
  applyCompletedRedaction,
  applyStartedRedaction,
  approvalRequiredResult,
  errorResult,
  executedResult,
  isAllowed,
  mergedVerdictMetadata,
  rejectedResult,
  resultForAllowedVerdict,
  stoppedResult,
} from './results.js';
import type {
  GovernedCopilotTool,
  GovernedCopilotToolDefinition,
  OpenBoxCopilotActionInput,
  OpenBoxCopilotActionResult,
  OpenBoxCopilotResumeInput,
  OpenBoxCopilotSessionState,
  OpenBoxCopilotTimingEvent,
  OpenBoxCopilotTimingKind,
  OpenBoxCopilotTimings,
} from './types.js';
import {
  activeWorkflowFor,
  clearActiveWorkflow,
  completeWorkflow,
  createWorkflowIds,
  createWorkflowSession,
  emitUserPromptSignal,
  failWorkflow,
  finishStoppedWorkflow,
  pollApproval,
  toolInput,
  toolSpan,
} from './workflow-session.js';

export function createGovernedCopilotTool<
  TInput extends OpenBoxCopilotActionInput,
  TArtifact = unknown,
>(
  definition: GovernedCopilotToolDefinition<TInput, TArtifact>,
): GovernedCopilotTool<TInput, TArtifact> {
  const haltedSessions = new Map<
    string,
    Extract<OpenBoxCopilotSessionState, { status: 'halted' }>
  >();
  const workflowType = DEFAULT_WORKFLOW_TYPE;
  const taskQueue = DEFAULT_TASK_QUEUE;

  const normalize = (input: TInput) =>
    definition.normalizeInput ? definition.normalizeInput(input) : input;
  const sessionKey = (config?: unknown) =>
    definition.sessionKey
      ? definition.sessionKey(config)
      : sessionKeyFromConfig(config);

  async function execute(
    input: TInput,
    runtimeConfig?: unknown,
  ): Promise<OpenBoxCopilotActionResult<TArtifact>> {
    const normalizedInput = normalize(input);
    const timings = createTimingCollector((event) =>
      definition.onTimingEvent?.(event, { input: normalizedInput, runtimeConfig }),
    );
    const key = sessionKey(runtimeConfig);
    const haltedSession = haltedSessions.get(key);
    if (haltedSession)
      return evaluateHaltedWorkflow(
        normalizedInput,
        key,
        haltedSession,
        runtimeConfig,
      ) as Promise<OpenBoxCopilotActionResult<TArtifact>>;
    // Attach to the task workflow opened by the CopilotKit runtime or the
    // LangChain middleware so one user task maps to one OpenBox session.
    // The run config is per-run truth; the in-process registry covers
    // middleware-owned runs. Standalone tool usage keeps its own lifecycle.
    const shared =
      sharedWorkflowFromConfig(runtimeConfig) ??
      activeWorkflowFor(definition.adapter, key);
    if (process.env.OPENBOX_DEBUG === 'true') {
      console.error(
        `[openbox:governed-tool] key=${key} shared=${JSON.stringify(shared ?? null)} action=${String((normalizedInput as Record<string, unknown>).action ?? '')}`,
      );
    }
    const ids = shared
      ? { ...createWorkflowIds(), workflowId: shared.workflowId, runId: shared.runId }
      : createWorkflowIds();
    const ridesSharedWorkflow = Boolean(shared);

    if (!definition.adapter.isEnabled()) {
      const artifact = await timings.measure(
        'tool_execution',
        'Business action',
        'tool',
        () => definition.execute(normalizedInput),
      );
      return withTimings(
        executedResult(
          normalizedInput,
          ids,
          artifact,
          'OpenBox disabled for local development.',
        ),
        timings.finish(),
      );
    }

    try {
      // attached: the workflow is opened explicitly below (owned runs) or by
      // the CopilotKit runtime in another process (shared runs); gates must
      // never auto-open it.
      const session = createWorkflowSession(
        definition.adapter,
        ids,
        workflowType,
        taskQueue,
        { attached: true },
      );
      if (!ridesSharedWorkflow) {
        await timings.measure(
          'workflow_start',
          'Start governance workflow',
          'openbox',
          async () => {
            await session.workflowStarted();
            await emitUserPromptSignal(
              definition.adapter,
              ids,
              workflowType,
              taskQueue,
              normalizedInput.request,
            );
          },
        );
      }
      // Split-stage gate from the spec-generated runtime: input verdict now,
      // paired completion (same activity id) after the business logic runs.
      const openedActivity = await timings.measure(
        'tool_input_gate',
        'Input policy check',
        'openbox',
        () =>
          session.openActivity(definition.toolName, {
            activityId: ids.activityId,
            input: [toolInput(definition, normalizedInput)],
            ...(definition.spanProfile
              ? { spans: [toolSpan(definition, normalizedInput, 'started')] }
              : {}),
          }),
      );
      const started = openedActivity.verdict;

      if (started.arm === 'require_approval') {
        return withTimings(
          approvalRequiredResult(
            normalizedInput,
            ids,
            started,
          ) as OpenBoxCopilotActionResult<TArtifact>,
          timings.finish(),
        );
      }
      if (!isAllowed(started.arm)) {
        await timings.measure(
          'workflow_stop',
          'Stop governance workflow',
          'openbox',
          () =>
            finishStoppedWorkflow(
              definition.adapter,
              ids,
              workflowType,
              taskQueue,
              started,
            ),
        );
        if (ridesSharedWorkflow)
          clearActiveWorkflow(definition.adapter, key, ids.workflowId);
        const result = stoppedResult(normalizedInput, ids, started);
        if (result.status === 'halted')
          haltedSessions.set(key, result.session as any);
        return withTimings(
          result as OpenBoxCopilotActionResult<TArtifact>,
          timings.finish(),
        );
      }

      const startedRedaction = applyStartedRedaction(
        definition,
        normalizedInput,
        started,
      );
      const artifact = await timings.measure(
        'tool_execution',
        'Business action',
        'tool',
        () => definition.execute(startedRedaction.input),
      );
      const provisional = resultForAllowedVerdict(
        startedRedaction.input,
        ids,
        started,
        artifact,
        'OpenBox allowed this action.',
        startedRedaction.summary,
      );
      const completed = await timings.measure(
        'tool_output_gate',
        'Output policy check',
        'openbox',
        () =>
          openedActivity.complete(
            {
              input: [toolInput(definition, startedRedaction.input)],
              output: toolOutputForGovernance(provisional),
              ...(definition.spanProfile
                ? {
                    spans: [
                      toolSpan(definition, startedRedaction.input, 'completed'),
                    ],
                  }
                : {}),
            },
            definition.toolName,
          ),
      );

      if (!isAllowed(completed.arm)) {
        await timings.measure(
          'workflow_stop',
          'Stop governance workflow',
          'openbox',
          () =>
            finishStoppedWorkflow(
              definition.adapter,
              ids,
              workflowType,
              taskQueue,
              completed,
            ),
        );
        if (ridesSharedWorkflow)
          clearActiveWorkflow(definition.adapter, key, ids.workflowId);
        const stopped = stoppedResult(
          startedRedaction.input,
          ids,
          completed,
          provisional.executed,
        );
        if (stopped.status === 'halted')
          haltedSessions.set(key, stopped.session as any);
        return withTimings(
          stopped as OpenBoxCopilotActionResult<TArtifact>,
          timings.finish(),
        );
      }

      let result = applyCompletedRedaction(
        definition,
        provisional,
        completed,
        startedRedaction.summary,
      );
      if (!ridesSharedWorkflow) {
        const terminal = await timings.measure(
          'workflow_complete',
          'Complete governance workflow',
          'openbox',
          () => session.workflowCompleted(),
        );
        if (terminal) {
          result = {
            ...result,
            ...mergedVerdictMetadata(result, terminal),
          };
        }
      }
      return withTimings(result, timings.finish());
    } catch (error) {
      await timings.measure(
        'workflow_fail',
        'Record governance failure',
        'openbox',
        () =>
          failWorkflow(
            definition.adapter,
            ids,
            workflowType,
            taskQueue,
            error,
          ),
      );
      if (ridesSharedWorkflow)
        clearActiveWorkflow(definition.adapter, key, ids.workflowId);
      return withTimings(
        errorResult(
          normalizedInput,
          ids,
          error,
        ) as OpenBoxCopilotActionResult<TArtifact>,
        timings.finish(),
      );
    }
  }

  async function resume(
    input: TInput & OpenBoxCopilotResumeInput,
    runtimeConfig?: unknown,
  ): Promise<OpenBoxCopilotActionResult<TArtifact>> {
    const normalizedInput = normalize(input) as TInput &
      OpenBoxCopilotResumeInput;
    const timings = createTimingCollector((event) =>
      definition.onTimingEvent?.(event, { input: normalizedInput, runtimeConfig }),
    );
    const key = sessionKey(runtimeConfig);
    const haltedSession = haltedSessions.get(key);
    if (haltedSession)
      return evaluateHaltedWorkflow(
        normalizedInput,
        key,
        haltedSession,
        runtimeConfig,
      ) as Promise<OpenBoxCopilotActionResult<TArtifact>>;
    const ids = {
      workflowId: normalizedInput.workflowId,
      runId: normalizedInput.runId,
      activityId: normalizedInput.activityId,
    };

    if (!definition.adapter.isEnabled()) {
      const artifact = await timings.measure(
        'tool_execution',
        'Business action',
        'tool',
        () => definition.execute(normalizedInput),
      );
      return withTimings(
        executedResult(
          normalizedInput,
          ids,
          artifact,
          'OpenBox disabled for local development.',
        ),
        timings.finish(),
      );
    }

    try {
      const polled = await timings.measure(
        'approval_poll',
        'Approval decision check',
        'openbox',
        () => pollApproval(definition.adapter, ids),
      );
      if (!isAllowed(polled.arm)) {
        await timings.measure(
          'workflow_stop',
          'Stop governance workflow',
          'openbox',
          () =>
            finishStoppedWorkflow(
              definition.adapter,
              ids,
              workflowType,
              taskQueue,
              polled,
            ),
        );
        if (normalizedInput.approved === false)
          return withTimings(
            rejectedResult(
              normalizedInput,
              ids,
              polled,
            ) as OpenBoxCopilotActionResult<TArtifact>,
            timings.finish(),
          );
        const stopped = stoppedResult(normalizedInput, ids, polled);
        if (stopped.status === 'halted')
          haltedSessions.set(key, stopped.session as any);
        return withTimings(
          stopped as OpenBoxCopilotActionResult<TArtifact>,
          timings.finish(),
        );
      }

      const artifact = await timings.measure(
        'tool_execution',
        'Business action',
        'tool',
        () => definition.execute(normalizedInput),
      );
      const result = resultForAllowedVerdict(
        normalizedInput,
        ids,
        polled,
        artifact,
        'OpenBox approval was granted.',
      );
      // Pairs the approval's original ActivityStarted across requests via
      // the caller-supplied activity id.
      const completed = await timings.measure(
        'tool_output_gate',
        'Output policy check',
        'openbox',
        () =>
          createWorkflowSession(
            definition.adapter,
            ids,
            workflowType,
            taskQueue,
            { attached: true, inlineApproval: true },
          ).activity('ActivityCompleted', definition.toolName, {
            activityId: ids.activityId,
            input: [approvalResumeToolInput(definition, normalizedInput)],
            output: toolOutputForGovernance(result),
            spans: [approvalResumeSpan(definition, normalizedInput)],
          }),
      );

      const alreadyApprovedAgain =
        completed.arm === 'require_approval' && normalizedInput.approved === true;

      if (!isAllowed(completed.arm) && !alreadyApprovedAgain) {
        await timings.measure(
          'workflow_stop',
          'Stop governance workflow',
          'openbox',
          () =>
            finishStoppedWorkflow(
              definition.adapter,
              ids,
              workflowType,
              taskQueue,
              completed,
            ),
        );
        const stopped = stoppedResult(
          normalizedInput,
          ids,
          completed,
          result.executed,
        );
        if (stopped.status === 'halted')
          haltedSessions.set(key, stopped.session as any);
        return withTimings(
          stopped as OpenBoxCopilotActionResult<TArtifact>,
          timings.finish(),
        );
      }

      const terminal = await timings.measure(
        'workflow_complete',
        'Complete governance workflow',
        'openbox',
        () => completeWorkflow(definition.adapter, ids, workflowType, taskQueue),
      );
      const completedResult = applyCompletedRedaction(
        definition,
        result,
        completed,
      );
      return withTimings(
        terminal
          ? {
              ...completedResult,
              ...mergedVerdictMetadata(completedResult, terminal),
            }
          : completedResult,
        timings.finish(),
      );
    } catch (error) {
      await timings.measure(
        'workflow_fail',
        'Record governance failure',
        'openbox',
        () =>
          failWorkflow(
            definition.adapter,
            ids,
            workflowType,
            taskQueue,
            error,
          ),
      );
      return withTimings(
        errorResult(
          normalizedInput,
          ids,
          error,
        ) as OpenBoxCopilotActionResult<TArtifact>,
        timings.finish(),
      );
    }
  }

  async function evaluateHaltedWorkflow(
    input: TInput,
    key: string,
    haltedSession: Extract<OpenBoxCopilotSessionState, { status: 'halted' }>,
    runtimeConfig?: unknown,
  ): Promise<OpenBoxCopilotActionResult<TArtifact>> {
    const timings = createTimingCollector((event) =>
      definition.onTimingEvent?.(event, { input, runtimeConfig }),
    );
    const generatedIds = createWorkflowIds();
    const ids = {
      workflowId: haltedSession.workflowId ?? generatedIds.workflowId,
      runId: haltedSession.runId ?? generatedIds.runId,
      activityId: generatedIds.activityId,
    };

    if (!definition.adapter.isEnabled()) {
      return withTimings(
        stoppedResult(input, ids, {
          arm: 'halt',
          reason: haltedSession.reason,
          riskScore: 0,
        }) as OpenBoxCopilotActionResult<TArtifact>,
        timings.finish(),
      );
    }

    try {
      // Start-only gate on the halted workflow; the runtime expects a
      // non-allow verdict here, so the start is canonically unpaired.
      const { verdict } = await timings.measure(
        'halted_session_gate',
        'Halted session check',
        'openbox',
        () =>
          createWorkflowSession(
            definition.adapter,
            { workflowId: ids.workflowId, runId: ids.runId },
            workflowType,
            taskQueue,
            { attached: true, inlineApproval: true },
          ).openActivity(definition.toolName, {
            activityId: ids.activityId,
            input: [toolInput(definition, input)],
            ...(definition.spanProfile
              ? { spans: [toolSpan(definition, input, 'started')] }
              : {}),
          }),
      );
      if (isAllowed(verdict.arm)) {
        return withTimings(
          errorResult(
            input,
            ids,
            new Error(
              'OpenBox allowed an action on a previously halted CopilotKit workflow.',
            ),
          ) as OpenBoxCopilotActionResult<TArtifact>,
          timings.finish(),
        );
      }
      await timings.measure(
        'workflow_stop',
        'Stop governance workflow',
        'openbox',
        () =>
          finishStoppedWorkflow(
            definition.adapter,
            ids,
            workflowType,
            taskQueue,
            verdict,
          ),
      );
      const stopped = stoppedResult(input, ids, verdict);
      if (stopped.status === 'halted')
        haltedSessions.set(key, stopped.session as any);
      return withTimings(
        stopped as OpenBoxCopilotActionResult<TArtifact>,
        timings.finish(),
      );
    } catch (error) {
      return withTimings(
        errorResult(
          input,
          ids,
          error,
        ) as OpenBoxCopilotActionResult<TArtifact>,
        timings.finish(),
      );
    }
  }

  return { execute, resume };
}

function toolOutputForGovernance<TArtifact>(
  result: OpenBoxCopilotActionResult<TArtifact>,
) {
  return { artifact: result.artifact };
}

function approvalResumeToolInput<
  TInput extends OpenBoxCopilotActionInput & OpenBoxCopilotResumeInput,
>(
  definition: Pick<GovernedCopilotToolDefinition<any, any>, 'toolName' | 'description'>,
  input: TInput,
) {
  return {
    id: undefined,
    name: definition.toolName,
    args: approvalResumeMetadata(input),
    description: definition.description,
  };
}

function approvalResumeSpan<
  TInput extends OpenBoxCopilotActionInput & OpenBoxCopilotResumeInput,
>(
  definition: Pick<GovernedCopilotToolDefinition<any, any>, 'toolName'>,
  input: TInput,
) {
  const now = nowUnixNano();
  return {
    span_id: `approval-${randomUUID().replaceAll('-', '').slice(0, 8)}`,
    trace_id: randomUUID().replaceAll('-', ''),
    name: `${definition.toolName}.approval_resume`,
    kind: 'internal',
    start_time: now,
    end_time: now,
    duration_ns: 0,
    stage: 'completed',
    attributes: {
      'openbox.tool.name': definition.toolName,
      'openbox.approval.resume': true,
      'tool.name': definition.toolName,
    },
    data: approvalResumeMetadata(input),
  };
}

function approvalResumeMetadata(input: OpenBoxCopilotResumeInput) {
  return {
    approved: input.approved === true,
    approvalId: input.approvalId,
    governanceEventId: input.governanceEventId,
    workflowId: input.workflowId,
    runId: input.runId,
    activityId: input.activityId,
  };
}

function createTimingCollector(
  onTimingEvent?: (event: OpenBoxCopilotTimingEvent) => Promise<void> | void,
) {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const steps: OpenBoxCopilotTimings['steps'] = [];

  const emit = async (event: OpenBoxCopilotTimingEvent) => {
    if (!onTimingEvent) return;
    try {
      await onTimingEvent(event);
    } catch (error) {
      console.warn(
        `[openbox:copilotkit] timing event observer failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };

  return {
    async measure<T>(
      key: string,
      label: string,
      kind: OpenBoxCopilotTimingKind,
      operation: () => Promise<T> | T,
    ): Promise<T> {
      const stepStartedAt = Date.now();
      const stepStartedAtIso = new Date(stepStartedAt).toISOString();
      await emit({
        phase: 'started',
        key,
        label,
        kind,
        startedAt: stepStartedAtIso,
      });
      try {
        return await operation();
      } finally {
        const completedAtMs = Date.now();
        const ms = Math.max(0, completedAtMs - stepStartedAt);
        steps.push({
          key,
          label,
          kind,
          ms,
        });
        await emit({
          phase: 'finished',
          key,
          label,
          kind,
          startedAt: stepStartedAtIso,
          completedAt: new Date(completedAtMs).toISOString(),
          ms,
        });
      }
    },
    finish(): OpenBoxCopilotTimings {
      const completedAtMs = Date.now();
      return {
        startedAt,
        completedAt: new Date(completedAtMs).toISOString(),
        totalMs: Math.max(0, completedAtMs - startedAtMs),
        steps: [...steps],
      };
    },
  };
}

function withTimings<TArtifact>(
  result: OpenBoxCopilotActionResult<TArtifact>,
  timings: OpenBoxCopilotTimings,
): OpenBoxCopilotActionResult<TArtifact> {
  return { ...result, timings };
}

function sharedWorkflowFromConfig(
  runtimeConfig: unknown,
): { workflowId: string; runId: string; owned: boolean } | undefined {
  if (!runtimeConfig || typeof runtimeConfig !== 'object') return undefined;
  const configurable = (runtimeConfig as Record<string, any>).configurable;
  if (!configurable || typeof configurable !== 'object') return undefined;
  const workflowId = configurable.openboxWorkflowId;
  const runId = configurable.openboxRunId;
  if (typeof workflowId !== 'string' || typeof runId !== 'string')
    return undefined;
  return { workflowId, runId, owned: false };
}
