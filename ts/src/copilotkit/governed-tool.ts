import { randomBytes, randomUUID } from 'node:crypto';
import type { SpanData } from '../core-client/index.js';
import { DEFAULT_TASK_QUEUE, DEFAULT_WORKFLOW_TYPE } from './constants.js';
import {
  errorOutput,
  nowUnixNano,
  sessionKeyFromConfig,
} from './internal-utils.js';
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
  toolActivityInput,
  toolInput,
  toolSpan,
  withCopilotToolActivityMetadata,
  withSpanIdentityFromActivity,
} from './workflow-session.js';
import { EVENT } from '../governance/events.js';
import {
  buildSpan,
  leanCopilotLlmSpan,
  stripServerComputedSemantic,
} from '../governance/spans.js';
import {
  capturedLLMExchanges,
  runWithLLMCapture,
  type CapturedLLMExchange,
} from './otel-capture.js';

type HaltedCopilotSession = Extract<
  OpenBoxCopilotSessionState,
  { status: 'halted' }
>;

export function createGovernedCopilotTool<
  TInput extends OpenBoxCopilotActionInput,
  TArtifact = unknown,
>(
  definition: GovernedCopilotToolDefinition<TInput, TArtifact>,
): GovernedCopilotTool<TInput, TArtifact> {
  const haltedSessions = new Map<
    string,
    HaltedCopilotSession
  >();
  const workflowType = DEFAULT_WORKFLOW_TYPE;
  const taskQueue = DEFAULT_TASK_QUEUE;
  const activityType = governedToolActivityType(definition);

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
      // never auto-open it. CopilotKit host flows need approval_required back
      // as a tool result so the UI/backend approval route can resume it.
      const session = createWorkflowSession(
        definition.adapter,
        ids,
        workflowType,
        taskQueue,
        { attached: true, inlineApproval: true },
      );
      if (!ridesSharedWorkflow) {
        await timings.measure(
          'workflow_start',
          'Start governance workflow',
          'openbox',
          async () => {
            await emitUserPromptSignal(
              definition.adapter,
              ids,
              workflowType,
              taskQueue,
              normalizedInput.request,
              key,
            );
            await session.workflowStarted();
          },
        );
      }
      // Split-stage gate from the spec-generated runtime: input verdict now,
      // paired completion (same activity id) after the business logic runs.
      const toolStartedNs = nowUnixNano();
      const openedActivity = await timings.measure(
        'tool_input_gate',
        'Input policy check',
        'openbox',
        () =>
          session.openActivity(activityType, {
            activityId: ids.activityId,
            input: toolActivityInput(definition, normalizedInput),
            spans: [
              toolSpan(
                definition,
                normalizedInput,
                'started',
                undefined,
                ids.activityId,
                toolStartedNs,
              ),
              ...(definition.operationSpans?.(
                normalizedInput,
                'started',
                ids.activityId,
              ) ?? []),
            ],
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
        rememberHaltedSession(haltedSessions, key, result.session);
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
      let artifact: TArtifact;
      // The SDK's global OTel fetch instrumentation records the LLM call(s) the
      // business action makes; collect them inside the capture scope so they can
      // be surfaced as real llm_completion spans on the completed activity.
      let llmCaptures: CapturedLLMExchange[] = [];
      try {
        artifact = await timings.measure(
          'tool_execution',
          'Business action',
          'tool',
          () =>
            runWithLLMCapture(async () => {
              try {
                return await definition.execute(startedRedaction.input);
              } finally {
                llmCaptures = capturedLLMExchanges();
              }
            }),
        );
      } catch (error) {
        await timings.measure(
          'tool_output_gate',
          'Record failed tool output',
          'openbox',
          async () => {
            try {
              await openedActivity.complete(
                {
                  input: toolActivityInput(definition, startedRedaction.input),
                  output: failedToolOutputForGovernance(error),
                  spans: [
                    toolSpan(
                      definition,
                      startedRedaction.input,
                      'completed',
                      failedToolOutputForGovernance(error),
                      ids.activityId,
                      toolStartedNs,
                    ),
                    ...(definition.operationSpans?.(
                      startedRedaction.input,
                      'completed',
                      ids.activityId,
                    ) ?? []),
                    ...capturedLlmCompletionSpans(llmCaptures),
                  ],
                  hookSpanParentEventType: EVENT.START,
                },
                activityType,
              );
            } catch {
              // Preserve the business error. WorkflowFailed below records the terminal state.
            }
          },
        );
        throw error;
      }
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
              input: toolActivityInput(definition, startedRedaction.input),
              output: toolOutputForGovernance(provisional),
              spans: [
                toolSpan(
                  definition,
                  startedRedaction.input,
                  'completed',
                  toolOutputForGovernance(provisional),
                  ids.activityId,
                  toolStartedNs,
                ),
                ...(definition.operationSpans?.(
                  startedRedaction.input,
                  'completed',
                  ids.activityId,
                ) ?? []),
                ...capturedLlmCompletionSpans(llmCaptures),
              ],
              hookSpanParentEventType: EVENT.START,
            },
            activityType,
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
        rememberHaltedSession(haltedSessions, key, stopped.session);
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
        rememberHaltedSession(haltedSessions, key, stopped.session);
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
          ).activity(EVENT.COMPLETE, activityType, {
            activityId: ids.activityId,
            input: withCopilotToolActivityMetadata([
              approvalResumeToolInput(definition, normalizedInput),
            ]),
            output: toolOutputForGovernance(result),
            spans: [
              approvalResumeSpan(definition, normalizedInput, ids.activityId),
              ...(definition.operationSpans?.(
                normalizedInput,
                'completed',
                ids.activityId,
              ) ?? []),
            ],
            hookSpanParentEventType: EVENT.START,
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
        rememberHaltedSession(haltedSessions, key, stopped.session);
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
          ).openActivity(governedToolActivityType(definition), {
            activityId: ids.activityId,
            input: toolActivityInput(definition, input),
            spans: [
              toolSpan(definition, input, 'started', undefined, ids.activityId),
              ...(definition.operationSpans?.(
                input,
                'started',
                ids.activityId,
              ) ?? []),
            ],
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
      rememberHaltedSession(haltedSessions, key, stopped.session);
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

// Surface the LLM call(s) the business action made (captured by the SDK's OTel
// fetch instrumentation) as full-data llm_completion span pairs, so a governed
// action carries the same real request/response/headers/body/usage/duration as
// the middleware path. Each captured exchange becomes a started+completed pair
// sharing one span_id.
function capturedLlmCompletionSpans(
  captures: CapturedLLMExchange[],
): SpanData[] {
  const redact = process.env.OPENBOX_CAPTURE_RAW_HEADERS !== 'true';
  const fieldString = (value: unknown, key: string): string | undefined => {
    const record =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    return typeof record[key] === 'string' ? (record[key] as string) : undefined;
  };
  return captures.flatMap((exchange) => {
    const spanId = randomBytes(8).toString('hex');
    const traceId = randomBytes(16).toString('hex');
    const identify = (span: Record<string, unknown>): Record<string, unknown> => ({
      ...span,
      span_id: spanId,
      trace_id: traceId,
    });
    // All values come from the real captured exchange: model from the wire
    // body, URL from the actual request, headers/body/status/timing verbatim.
    const model =
      fieldString(exchange.requestBody, 'model') ??
      fieldString(exchange.responseBody, 'model');
    const startedNs = exchange.startTimeMs * 1_000_000;
    const endedNs = exchange.endTimeMs * 1_000_000;
    const durationNs = Math.max(0, endedNs - startedNs);
    const started = identify(
      buildSpan('copilotkit', 'llm', {
        stage: 'started',
        model,
        url: exchange.url,
        rawRequestBody: exchange.requestBody,
        request_headers: exchange.requestHeaders,
        redactSensitiveHeaders: redact,
      }),
    );
    const completed = identify(
      buildSpan('copilotkit', 'llm', {
        stage: 'completed',
        model,
        url: exchange.url,
        rawRequestBody: exchange.requestBody,
        rawResponseBody: exchange.responseBody,
        request_headers: exchange.requestHeaders,
        response_headers: exchange.responseHeaders,
        http_status_code: exchange.httpStatusCode,
        redactSensitiveHeaders: redact,
      }),
    );
    return [
      leanCopilotLlmSpan({ ...started, start_time: startedNs, end_time: 0 }),
      leanCopilotLlmSpan({
        ...completed,
        start_time: startedNs,
        end_time: endedNs,
        duration_ns: durationNs,
      }),
    ] as unknown as SpanData[];
  });
}

function toolOutputForGovernance<TArtifact>(
  result: OpenBoxCopilotActionResult<TArtifact>,
) {
  return { artifact: result.artifact };
}

function failedToolOutputForGovernance(error: unknown) {
  return {
    status: 'failed',
    error: errorOutput(error),
  };
}

function governedToolActivityType(
  definition: Pick<GovernedCopilotToolDefinition<any, any>, 'toolName'>,
): string {
  const toolName = definition.toolName.trim();
  return toolName || 'copilotkit_tool';
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
  activityId?: string,
) {
  const now = nowUnixNano();
  // Pair this resume completion with the original approval-request started
  // span by deriving the span identity from the shared activity id.
  return withSpanIdentityFromActivity(
    stripServerComputedSemantic({
      span_id: `approval-${randomUUID().replaceAll('-', '').slice(0, 8)}`,
      trace_id: randomUUID().replaceAll('-', ''),
      name: `${definition.toolName}.approval_resume`,
      kind: 'internal',
      // Reference shape: function-call operations are span_type 'internal'.
      span_type: 'internal',
      hook_type: 'function_call',
      start_time: now,
      end_time: now,
      duration_ns: 0,
      stage: 'completed',
      status: { code: 'UNSET' },
      events: [],
      attributes: {
        'openbox.span_type': 'internal',
        'openbox.tool.name': definition.toolName,
        'openbox.approval.resume': true,
        'tool.name': definition.toolName,
        tool_name: definition.toolName,
      },
      data: approvalResumeMetadata(input),
    }),
    activityId,
  );
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

function rememberHaltedSession(
  haltedSessions: Map<string, HaltedCopilotSession>,
  key: string,
  session: OpenBoxCopilotSessionState | undefined,
) {
  if (session?.status === 'halted') haltedSessions.set(key, session);
}

function sharedWorkflowFromConfig(
  runtimeConfig: unknown,
): { workflowId: string; runId: string; owned: boolean } | undefined {
  if (!runtimeConfig || typeof runtimeConfig !== 'object') return undefined;
  const configurable = (runtimeConfig as Record<string, unknown>).configurable;
  if (!configurable || typeof configurable !== 'object') return undefined;
  const configurableRecord = configurable as Record<string, unknown>;
  const workflowId = configurableRecord.openboxWorkflowId;
  const runId = configurableRecord.openboxRunId;
  if (typeof workflowId !== 'string' || typeof runId !== 'string')
    return undefined;
  return { workflowId, runId, owned: false };
}
