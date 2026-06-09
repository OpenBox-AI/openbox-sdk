import { DEFAULT_TASK_QUEUE, DEFAULT_WORKFLOW_TYPE } from './constants.js';
import { sessionKeyFromConfig } from './internal-utils.js';
import {
  applyCompletedRedaction,
  applyStartedRedaction,
  approvalRequiredResult,
  errorResult,
  executedResult,
  isAllowed,
  rejectedResult,
  resultForAllowedVerdict,
  sessionHaltedResult,
  stoppedResult,
} from './results.js';
import type {
  GovernedCopilotTool,
  GovernedCopilotToolDefinition,
  OpenBoxCopilotActionInput,
  OpenBoxCopilotActionResult,
  OpenBoxCopilotResumeInput,
  OpenBoxCopilotSessionState,
} from './types.js';
import {
  activityEvent,
  completeWorkflow,
  createWorkflowIds,
  createWorkflowSession,
  emitUserPromptSignal,
  evaluate,
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
    const key = sessionKey(runtimeConfig);
    const haltedSession = haltedSessions.get(key);
    if (haltedSession)
      return sessionHaltedResult(
        normalizedInput,
        haltedSession,
      ) as OpenBoxCopilotActionResult<TArtifact>;
    const ids = createWorkflowIds();

    if (!definition.adapter.isEnabled()) {
      const artifact = await definition.execute(normalizedInput);
      return executedResult(
        normalizedInput,
        ids,
        artifact,
        'OpenBox disabled for local development.',
      );
    }

    try {
      const session = createWorkflowSession(
        definition.adapter,
        ids,
        workflowType,
        taskQueue,
      );
      await session.workflowStarted();
      await emitUserPromptSignal(
        definition.adapter,
        ids,
        workflowType,
        taskQueue,
        normalizedInput.request,
      );
      const started = await evaluate(
        definition.adapter,
        activityEvent('ActivityStarted', ids, workflowType, taskQueue, {
          activity_input: [toolInput(definition, normalizedInput)],
          spans: [toolSpan(definition, normalizedInput, 'started')],
        }),
      );

      if (started.arm === 'require_approval') {
        return approvalRequiredResult(
          normalizedInput,
          ids,
          started,
        ) as OpenBoxCopilotActionResult<TArtifact>;
      }
      if (!isAllowed(started.arm)) {
        await finishStoppedWorkflow(
          definition.adapter,
          ids,
          workflowType,
          taskQueue,
          started,
        );
        const result = stoppedResult(normalizedInput, ids, started);
        if (result.status === 'halted')
          haltedSessions.set(key, result.session as any);
        return result as OpenBoxCopilotActionResult<TArtifact>;
      }

      const startedRedaction = applyStartedRedaction(
        definition,
        normalizedInput,
        started,
      );
      const artifact = await definition.execute(startedRedaction.input);
      const provisional = resultForAllowedVerdict(
        startedRedaction.input,
        ids,
        started,
        artifact,
        'OpenBox allowed this action.',
        startedRedaction.summary,
      );
      const completed = await evaluate(
        definition.adapter,
        activityEvent('ActivityCompleted', ids, workflowType, taskQueue, {
          activity_input: [toolInput(definition, startedRedaction.input)],
          activity_output: provisional,
          spans: [toolSpan(definition, startedRedaction.input, 'completed')],
        }),
      );

      if (!isAllowed(completed.arm)) {
        await finishStoppedWorkflow(
          definition.adapter,
          ids,
          workflowType,
          taskQueue,
          completed,
        );
        const stopped = stoppedResult(
          startedRedaction.input,
          ids,
          completed,
          provisional.executed,
        );
        if (stopped.status === 'halted')
          haltedSessions.set(key, stopped.session as any);
        return stopped as OpenBoxCopilotActionResult<TArtifact>;
      }

      const result = applyCompletedRedaction(
        definition,
        provisional,
        completed,
        startedRedaction.summary,
      );
      await session.workflowCompleted();
      return result;
    } catch (error) {
      await failWorkflow(
        definition.adapter,
        ids,
        workflowType,
        taskQueue,
        error,
      );
      return errorResult(
        normalizedInput,
        ids,
        error,
      ) as OpenBoxCopilotActionResult<TArtifact>;
    }
  }

  async function resume(
    input: TInput & OpenBoxCopilotResumeInput,
    runtimeConfig?: unknown,
  ): Promise<OpenBoxCopilotActionResult<TArtifact>> {
    const normalizedInput = normalize(input) as TInput &
      OpenBoxCopilotResumeInput;
    const key = sessionKey(runtimeConfig);
    const haltedSession = haltedSessions.get(key);
    if (haltedSession)
      return sessionHaltedResult(
        normalizedInput,
        haltedSession,
      ) as OpenBoxCopilotActionResult<TArtifact>;
    const ids = {
      workflowId: normalizedInput.workflowId,
      runId: normalizedInput.runId,
      activityId: normalizedInput.activityId,
    };

    if (!definition.adapter.isEnabled()) {
      const artifact = await definition.execute(normalizedInput);
      return executedResult(
        normalizedInput,
        ids,
        artifact,
        'OpenBox disabled for local development.',
      );
    }

    try {
      const polled = await pollApproval(definition.adapter, ids);
      if (!isAllowed(polled.arm)) {
        await finishStoppedWorkflow(
          definition.adapter,
          ids,
          workflowType,
          taskQueue,
          polled,
        );
        if (normalizedInput.approved === false)
          return rejectedResult(
            normalizedInput,
            ids,
            polled,
          ) as OpenBoxCopilotActionResult<TArtifact>;
        const stopped = stoppedResult(normalizedInput, ids, polled);
        if (stopped.status === 'halted')
          haltedSessions.set(key, stopped.session as any);
        return stopped as OpenBoxCopilotActionResult<TArtifact>;
      }

      const artifact = await definition.execute(normalizedInput);
      const result = resultForAllowedVerdict(
        normalizedInput,
        ids,
        polled,
        artifact,
        'OpenBox approval was granted.',
      );
      const completed = await evaluate(
        definition.adapter,
        activityEvent('ActivityCompleted', ids, workflowType, taskQueue, {
          activity_input: [toolInput(definition, normalizedInput)],
          activity_output: result,
          spans: [toolSpan(definition, normalizedInput, 'completed')],
        }),
      );

      if (!isAllowed(completed.arm)) {
        await finishStoppedWorkflow(
          definition.adapter,
          ids,
          workflowType,
          taskQueue,
          completed,
        );
        const stopped = stoppedResult(
          normalizedInput,
          ids,
          completed,
          result.executed,
        );
        if (stopped.status === 'halted')
          haltedSessions.set(key, stopped.session as any);
        return stopped as OpenBoxCopilotActionResult<TArtifact>;
      }

      await completeWorkflow(definition.adapter, ids, workflowType, taskQueue);
      return applyCompletedRedaction(definition, result, completed);
    } catch (error) {
      await failWorkflow(
        definition.adapter,
        ids,
        workflowType,
        taskQueue,
        error,
      );
      return errorResult(
        normalizedInput,
        ids,
        error,
      ) as OpenBoxCopilotActionResult<TArtifact>;
    }
  }

  return { execute, resume };
}
