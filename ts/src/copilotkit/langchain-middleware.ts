import { randomUUID } from 'node:crypto';
import {
  OPENBOX_COPILOTKIT_RESULT_SCHEMA_VERSION,
  OPENBOX_RUNTIME_PROMPT_GOVERNED_KEY,
} from './constants.js';
import { COPILOTKIT_LLM_ACTIVITY_TYPE } from './activity-types.js';
import { PRESET_ACTIVITY_TYPES } from '../core-client/generated/govern.js';
import {
  errorOutput,
  gateAlignmentScore,
  gateGoalDrifted,
  isRecord,
  modelInput,
  modelNameFromRequest,
  modelProviderFromRequest,
  objectRecord,
  runIdFromState,
  sessionKeyFromConfig,
  shouldStopForGate,
  summarizeMessages,
  swallow,
  toPlain,
  toolCallInput,
  withGoalDriftNote,
  withGovernedAssistantOutput,
  withGovernedModelInput,
  withGovernedToolInput,
  workflowIdFromState,
} from './internal-utils.js';
import type {
  OpenBoxCopilotKitAdapter,
  OpenBoxCopilotLangChainMiddlewareDeps,
} from './types.js';
import {
  latestCapturedLLMExchange,
  registerOpenBoxOtel,
  runWithLLMCapture,
} from './otel-capture.js';
import {
  activeWorkflowFor,
  clearAllActiveWorkflows,
  clearActiveWorkflow,
  createWorkflowSession,
  finishStoppedWorkflow,
  registerActiveWorkflow,
} from './workflow-session.js';

const langchainActivity = PRESET_ACTIVITY_TYPES.langchain;

export function createOpenBoxLangChainMiddleware({
  adapter,
  deps,
  workflowType,
  taskQueue,
  selfGovernedToolNames,
  strict,
}: {
  adapter: OpenBoxCopilotKitAdapter;
  deps: OpenBoxCopilotLangChainMiddlewareDeps;
  workflowType: string;
  taskQueue: string;
  selfGovernedToolNames: Set<string>;
  strict: boolean;
}) {
  // SDK-owned OTel wiring: instrument the global fetch so the agent's LLM calls
  // are captured with no host-side plumbing. Idempotent; only LLM endpoints are
  // wrapped, all other traffic passes through untouched.
  registerOpenBoxOtel();
  const workflowKey = (...candidates: unknown[]) => {
    for (const candidate of candidates) {
      const key = sessionKeyFromConfig(candidate);
      if (key !== 'default') return key;
    }
    return 'default';
  };
  const workflowIdsFor = (key: string, state: unknown) => {
    const registered = activeWorkflowFor(adapter, key);
    return {
      workflowId: workflowIdFromState(state) ?? registered?.workflowId,
      runId: runIdFromState(state) ?? registered?.runId,
    };
  };
  const debugState = (hook: string, state: unknown) => {
    if (process.env.OPENBOX_DEBUG !== 'true') return;
    const record = isRecord(state) ? state : {};
    console.error(
      `[openbox:${hook}] stateKeys=${JSON.stringify(Object.keys(record))} openboxSession=${JSON.stringify(record.openboxSession ?? null)} workflowId=${String(record.openboxWorkflowId ?? '')}`,
    );
  };
  // The CopilotKit runtime forwards its workflow IDs through the LangGraph
  // run config: AG-UI routes `forwardedProps.config.configurable` keys into
  // run context when the graph declares a context schema, and into
  // `runtime.configurable` otherwise. State is the in-process secondary source.
  const contextIds = (runtimeLike: unknown) => {
    const record = objectRecord(runtimeLike);
    const context = objectRecord(record.context);
    const configurable = objectRecord(record.configurable);
    const pick = (key: string) =>
      typeof context[key] === 'string'
        ? (context[key] as string)
        : typeof configurable[key] === 'string'
          ? (configurable[key] as string)
          : undefined;
    return {
      workflowId: pick('openboxWorkflowId'),
      runId: pick('openboxRunId'),
      promptActivityId: pick('openboxPromptActivityId'),
      promptGoverned:
        context.openboxPromptGoverned === true ||
        configurable.openboxPromptGoverned === true,
    };
  };
  // beforeAgent runs before LangGraph merges the run input into state, so
  // the CopilotKit runtime's workflow IDs are not visible there yet. The
  // task workflow is therefore resolved lazily at the first gate, where
  // state is real: adopt the runtime's workflow when its IDs are present,
  // otherwise open one owned by this process.
  const ensureTaskWorkflow = async (
    key: string,
    state: unknown,
    runtimeLike?: unknown,
  ) => {
    const fromContext = contextIds(runtimeLike);
    if (process.env.OPENBOX_DEBUG === 'true') {
      console.error(
        `[openbox:ensure] key=${key} fromContext=${JSON.stringify(fromContext)} stateWorkflowId=${String(workflowIdFromState(state) ?? '')}`,
      );
    }
    // Run config is per-run truth, so it beats any registry entry left over
    // from a previous run in this process.
    if (fromContext.workflowId && fromContext.runId) {
      const adopted = {
        workflowId: fromContext.workflowId,
        runId: fromContext.runId,
        owned: false,
      };
      registerActiveWorkflow(adapter, key, adopted);
      return adopted;
    }
    const existing = activeWorkflowFor(adapter, key);
    if (existing) return existing;
    const runtimeWorkflowId = workflowIdFromState(state);
    const runtimeRunId = runIdFromState(state);
    if (runtimeWorkflowId && runtimeRunId) {
      const adopted = {
        workflowId: runtimeWorkflowId,
        runId: runtimeRunId,
        owned: false,
      };
      registerActiveWorkflow(adapter, key, adopted);
      return adopted;
    }
    const owned = {
      workflowId: randomUUID(),
      runId: randomUUID(),
      owned: true,
    };
    registerActiveWorkflow(adapter, key, owned);
    return owned;
  };
  return deps.createMiddleware({
    name: 'openbox_copilotkit',
    stateSchema: deps.stateSchema,
    contextSchema: deps.contextSchema,
    wrapModelCall: async (
      request: any,
      handler: (request: any) => Promise<unknown>,
    ) => {
      if (!adapter.isEnabled()) return handler(request);
      debugState('wrapModelCall', request.state);
      const trailingToolResult = trailingToolContent(request.messages);
      const approvalResponse = openBoxApprovalResponse(trailingToolResult);
      if (approvalResponse) {
        return new deps.AIMessage({
          content: '',
          tool_calls: [
            {
              id: `openbox_resume_${randomUUID().replace(/-/g, '')}`,
              name: 'openbox_resume_governed_action',
              args: approvalResponse,
            },
          ],
        });
      }
      const trailingOpenBoxResult = openBoxResultFromContent(trailingToolResult);
      if (trailingOpenBoxResult) {
        if (isApprovalRequiredResult(trailingOpenBoxResult)) {
          const approvalToolCallId = `openbox_approval_${randomUUID().replace(
            /-/g,
            '',
          )}`;
          const approvalArgs = approvalReviewArgs(trailingOpenBoxResult);
          // openboxApprovalReview is a CLIENT-side HITL tool that the frontend
          // forwards into the run (state.copilotkit.actions). Return it as a
          // tool call on a synthetic assistant message: copilotkitMiddleware
          // (next in the middleware chain) strips that frontend tool call in
          // afterModel and pauses the run, which is what renders the v2
          // useHumanInTheLoop approval card and waits for respond().
          return new deps.AIMessage({
            content: '',
            tool_calls: [
              {
                id: approvalToolCallId,
                name: 'openboxApprovalReview',
                args: approvalArgs,
              },
            ],
          });
        }
        // A governed tool result is trailing. The governed CARD — the tool's own
        // lean structured output — IS the answer. Do NOT run the model again to
        // hand-roll a confirmation sentence: that continuation is unreliable
        // (gpt-5-nano re-calls the SAME governed tool instead of confirming,
        // producing duplicate "Reviewing" cards / a near-loop) and for terminal
        // verdicts would be suppressed downstream anyway. End the turn here so the
        // structured card stands as the response. (No hand-rolled confirm text.)
        return new deps.AIMessage({ content: '' });
      }
      const key = sessionKeyFromConfig(request);
      const llmModel = modelNameFromRequest(request);
      const llmProvider = modelProviderFromRequest(request);
      const gateIds = await ensureTaskWorkflow(
        key,
        request.state,
        request.runtime,
      );
      const session = createWorkflowSession(
        adapter,
        { workflowId: gateIds.workflowId, runId: gateIds.runId },
        workflowType,
        taskQueue,
      );
      const runtimePromptGoverned =
        (isRecord(request.state) &&
          request.state[OPENBOX_RUNTIME_PROMPT_GOVERNED_KEY] === true) ||
        contextIds(request.runtime).promptGoverned;
      let promptActivityId =
        contextIds(request.runtime).promptActivityId ??
        promptActivityIdFromState(request.state);
      if (!runtimePromptGoverned) {
        const promptGate = await adapter.governPrompt({
          payload: modelInput(request),
          sessionKey: key,
          workflowId: gateIds.workflowId,
          runId: gateIds.runId,
          activityType: COPILOTKIT_LLM_ACTIVITY_TYPE,
          llmModel,
          llmProvider,
          ensureWorkflowStarted: gateIds.owned,
        });
        promptActivityId = promptGate.activityId;
        if (shouldStopForGate(promptGate)) {
          return new deps.AIMessage({
            content: JSON.stringify(
              adapter.toOpenBoxCopilotResult(promptGate.verdict, promptGate),
            ),
          });
        }
        request = withGovernedModelInput(
          request,
          promptGate.safe,
          promptGate.changed,
        );
        // Goal drift is detected on the prompt gate (alert_only / non-blocking):
        // the verdict's `ageResult.goal_drifted` is available BEFORE the model
        // call. Surface it the only way that makes the model speak up for a
        // prose turn (no governed-action card to badge) — inject a short,
        // per-turn system note so the assistant acknowledges the off-goal
        // request. Only when Core actually flagged drift; never a static claim.
        if (gateGoalDrifted(promptGate)) {
          request = withGoalDriftNote(request, {
            alignmentScore: gateAlignmentScore(promptGate),
            SystemMessage: deps.SystemMessage,
          });
        }
      }
      const governedRoute = deps.routeLatestUserPrompt?.(request.messages);
      if (governedRoute) {
        const routedMessage = new deps.AIMessage({
          content: '',
          tool_calls: [
            {
              id: `openbox_preflight_${randomUUID().replace(/-/g, '')}`,
              name: governedRoute.toolName,
              args: governedRoute.args,
            },
          ],
        });
        // The prompt gate opened an `llm_call` ActivityStarted for this turn.
        // Routing short-circuits the real model call, so without this the
        // activity would never get its ActivityCompleted pair (observed:
        // ActivityStarted(llm_call) with no ActivityCompleted). Close it with
        // the routed assistant decision as the output so every ActivityStarted
        // has a matching ActivityCompleted. Only when this process actually
        // opened the activity (the prompt gate ran here).
        if (!runtimePromptGoverned && promptActivityId !== undefined) {
          await swallow(() =>
            adapter.governAssistantOutput({
              payload: toPlain(routedMessage),
              sessionKey: key,
              workflowId: gateIds.workflowId,
              runId: gateIds.runId,
              activityId: promptActivityId,
              activityType: COPILOTKIT_LLM_ACTIVITY_TYPE,
              llmModel,
              llmProvider,
              parentActivityStarted: true,
            }),
          );
        }
        return routedMessage;
      }
      try {
        // Run the real model call inside an OTel capture scope so the
        // instrumented client fetch records the actual provider request/
        // response (headers, raw body, status). Read the captured exchange
        // INSIDE the scope — the AsyncLocalStorage store is gone once
        // runWithLLMCapture returns. The capture feeds the llm_completion
        // span so it mirrors the wire payload.
        // Drop orphaned tool results (a `tool` whose tool_call_id has no
        // preceding assistant tool_call) that @ag-ui/langgraph's
        // langGraphDefaultMergeState/prepareStream reconciliation can leave on a
        // second governed tool call (pinned thread / two-step verify-then-read).
        // OpenAI rejects them with 400 INVALID_TOOL_RESULTS. We prune ONLY the
        // request handed to the model — the SDK's own approval/terminal detection
        // upstream still sees the full list. Never fabricates messages.
        const modelRequest = Array.isArray(request.messages)
          ? { ...request, messages: repairToolMessages(request.messages) }
          : request;
        const { response, captured } = await runWithLLMCapture(async () => {
          const result = await handler(modelRequest);
          return { response: result, captured: latestCapturedLLMExchange() };
        });
        const responseGate = await adapter.governAssistantOutput({
          payload: toPlain(response),
          sessionKey: key,
          workflowId: gateIds.workflowId,
          runId: gateIds.runId,
          activityId: promptActivityId,
          activityType: COPILOTKIT_LLM_ACTIVITY_TYPE,
          llmModel,
          llmProvider,
          parentActivityStarted: promptActivityId !== undefined,
          ...(captured
            ? {
                llmCapture: {
                  requestBody: captured.requestBody,
                  responseBody: captured.responseBody,
                  requestHeaders: captured.requestHeaders,
                  responseHeaders: captured.responseHeaders,
                  httpStatusCode: captured.httpStatusCode,
                },
                redactSensitiveHeaders:
                  process.env.OPENBOX_CAPTURE_RAW_HEADERS !== 'true',
                // Carry the REAL wall-clock timing of the provider HTTP
                // exchange (recorded by the instrumented fetch) so the
                // llm_completion span's start_time/end_time/duration reflect
                // the actual elapsed call instead of collapsing to a single
                // `now` (start === end, duration 0) when no prompt-gate start
                // time is available in this process.
                startTime: captured.startTimeMs,
                endTime: captured.endTimeMs,
                durationMs: Math.max(
                  0,
                  captured.endTimeMs - captured.startTimeMs,
                ),
              }
            : {}),
        });
        if (shouldStopForGate(responseGate)) {
          return new deps.AIMessage({
            content: JSON.stringify(
              adapter.toOpenBoxCopilotResult(
                responseGate.verdict,
                responseGate,
              ),
            ),
          });
        }
        return withGovernedAssistantOutput(response, responseGate.safe);
      } catch (error) {
        await swallow(() =>
          session.onLlmError({ output: errorOutput(error) }),
        );
        await swallow(() => session.workflowFailed(error));
        throw error;
      }
    },
    wrapToolCall: async (
      request: any,
      handler: (request: any) => Promise<unknown>,
    ) => {
      if (!adapter.isEnabled()) return handler(request);
      if (selfGovernedToolNames.has(String(request.toolCall?.name)))
        return handler(request);
      const key = sessionKeyFromConfig(request);
      const gateIds = await ensureTaskWorkflow(
        key,
        request.state,
        request.runtime,
      );
      const session = createWorkflowSession(
        adapter,
        { workflowId: gateIds.workflowId, runId: gateIds.runId },
        workflowType,
        taskQueue,
      );
      const inputGate = await adapter.governToolInput({
        payload: toolCallInput(request),
        sessionKey: key,
        workflowId: gateIds.workflowId,
        runId: gateIds.runId,
        activityType: toolActivityTypeFromRequest(request),
        ensureWorkflowStarted: gateIds.owned,
      });
      if (shouldStopForGate(inputGate)) {
        return JSON.stringify(
          adapter.toOpenBoxCopilotResult(inputGate.verdict, inputGate),
        );
      }
      request = withGovernedToolInput(request, inputGate.safe);
      try {
        const response = await handler(request);
        const outputGate = await adapter.governToolOutput({
          payload: toPlain(response),
          sessionKey: key,
          workflowId: gateIds.workflowId,
          runId: gateIds.runId,
          activityId: inputGate.activityId,
          activityType: toolActivityTypeFromRequest(request),
          parentActivityStarted: true,
        });
        if (shouldStopForGate(outputGate)) {
          return JSON.stringify(
            adapter.toOpenBoxCopilotResult(outputGate.verdict, outputGate),
          );
        }
        return outputGate.safe;
      } catch (error) {
        await swallow(() =>
          session.onToolError({
            output: { toolName: request.toolCall?.name, ...errorOutput(error) },
          }),
        );
        await swallow(() => session.workflowFailed(error));
        throw error;
      }
    },
    afterAgent: async (state: any, runtime: any) => {
      if (!adapter.isEnabled()) return;
      const key = workflowKey(runtime?.config, runtime, state);
      const fromContext = contextIds(runtime);
      const ids = workflowIdsFor(key, state);
      const workflowId = fromContext.workflowId ?? ids.workflowId;
      const runId = fromContext.runId ?? ids.runId;
      const active = activeWorkflowFor(adapter, key);
      // The CopilotKit runtime opened this workflow (IDs adopted from state
      // or registered as not-owned) and owns its terminal event; the agent
      // process must never close or double-gate it.
      const runtimeOwned =
        (active !== undefined &&
          active.workflowId === workflowId &&
          active.owned === false) ||
        fromContext.promptGoverned ||
        (isRecord(state) &&
          state[OPENBOX_RUNTIME_PROMPT_GOVERNED_KEY] === true);
      // The run is over in this process; drop any registry entry so the next
      // run cannot pick up a stale workflow through the registry.
      clearAllActiveWorkflows(adapter);
      if (!workflowId || !runId) return;
      if (runtimeOwned) return;
      const session = createWorkflowSession(
        adapter,
        { workflowId, runId },
        workflowType,
        taskQueue,
      );
      const finishGate = await adapter.governAssistantOutput({
        payload: {
          messages: summarizeMessages(state?.messages),
          structuredResponse: toPlain(state?.structuredResponse),
        },
        sessionKey: sessionKeyFromConfig(state),
        workflowId,
        runId,
        activityType: langchainActivity.onAgentFinish,
      });
      if (shouldStopForGate(finishGate) && strict) {
        await swallow(() =>
          finishStoppedWorkflow(
            adapter,
            { workflowId, runId },
            workflowType,
            taskQueue,
            finishGate.verdict,
          ),
        );
        return;
      }
      await swallow(() => session.workflowCompleted());
    },
  });
}

function toolActivityTypeFromRequest(request: any): string {
  const name = request?.toolCall?.name;
  return typeof name === 'string' && name.trim()
    ? name.trim()
    : langchainActivity.onToolStart;
}

function messageTypeOf(message: any): string {
  if (message && typeof message._getType === 'function') {
    return String(message._getType());
  }
  return String(message?.type ?? message?.role ?? '');
}

/**
 * Drop `tool` messages whose tool_call_id has no matching preceding assistant
 * tool_call in the same list. @ag-ui/langgraph's reconciliation can leave such
 * orphans on a second governed tool call (pinned thread / two-step), and OpenAI
 * rejects them with 400 INVALID_TOOL_RESULTS. Never adds or fabricates messages
 * — only removes a tool result that cannot legally be sent.
 */
function toolCallIdsOf(message: any): string[] {
  const toolCalls =
    message?.tool_calls ?? message?.additional_kwargs?.tool_calls ?? [];
  return toolCalls
    .map((tc: any) => tc?.id ?? tc?.tool_call_id)
    .filter(Boolean)
    .map(String);
}

function repairToolMessages(messages: any[]): any[] {
  // Rebuild so each assistant's tool results sit IMMEDIATELY after it. The real
  // cause of the 400 is order, not absence: CopilotKit's per-turn App Context
  // developer message can land between an assistant tool_call and its (present)
  // result. We also drop tool results with no declaring assistant, and drop a
  // content-less assistant whose tool_calls have no result. Never fabricates.
  const resultById = new Map<string, any>();
  for (const message of messages) {
    if (messageTypeOf(message) === 'tool' && message?.tool_call_id) {
      const id = String(message.tool_call_id);
      if (!resultById.has(id)) resultById.set(id, message);
    }
  }
  const placed = new Set<string>();
  const repaired: any[] = [];
  for (const message of messages) {
    const type = messageTypeOf(message);
    if (type === 'tool') continue; // re-placed right after its assistant
    if (type === 'ai' || type === 'assistant') {
      const ids = toolCallIdsOf(message);
      if (ids.length > 0) {
        const allResulted = ids.every((id) => resultById.has(id));
        const hasContent =
          typeof message?.content === 'string' &&
          message.content.trim().length > 0;
        if (!allResulted && !hasContent) continue; // unanswerable tool_call
        repaired.push(message);
        for (const id of ids) {
          const result = resultById.get(id);
          if (result && !placed.has(id)) {
            repaired.push(result);
            placed.add(id);
          }
        }
        continue;
      }
    }
    repaired.push(message);
  }
  return repaired;
}

function promptActivityIdFromState(state: unknown): string | undefined {
  const record = objectRecord(state);
  const openboxSession = objectRecord(record.openboxSession);
  if (typeof openboxSession.promptActivityId === 'string') {
    return openboxSession.promptActivityId;
  }
  return typeof record.openboxPromptActivityId === 'string'
    ? record.openboxPromptActivityId
    : undefined;
}

const OPENBOX_RESULT_STATUSES = new Set([
  'executed',
  'constrained',
  'allowed',
  'blocked',
  'halted',
  'session_halted',
  'rejected',
  'error',
  'approval_required',
  'approval_pending',
]);

function hasOpenBoxToolResult(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = objectRecord(messages[index]);
    if (isHumanMessage(message)) return false;
    if (isOpenBoxResult(messageContent(message))) return true;
  }
  return false;
}

function isHumanMessage(message: Record<string, unknown>): boolean {
  const role = String(message.role ?? message.type ?? '').toLowerCase();
  return role === 'human' || role === 'user';
}

function trailingToolContent(messages: unknown): unknown {
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  // Scan back from the end for the most-recent `tool` message, stepping over
  // trailing developer/system messages. CopilotKit/@ag-ui injects a per-turn
  // App Context developer/system message that can land AFTER the governed tool
  // result (the same trailing-App-Context behaviour that caused the earlier 400
  // INVALID_TOOL_RESULTS). If we only looked at the LAST message, that App
  // Context would hide the governed tool result, the short-circuit below would
  // be skipped, and the model would run again and re-call the governed tool —
  // producing a duplicate governance card. Stop at anything else (a human turn
  // or an assistant message) so a genuinely new prompt is never short-circuited.
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = objectRecord(messages[index]);
    const role = String(message.role ?? message.type ?? '').toLowerCase();
    if (role === 'developer' || role === 'system') continue;
    if (role === 'tool') return messageContent(message);
    return undefined;
  }
  return undefined;
}

function messageContent(message: Record<string, unknown>): unknown {
  if ('content' in message) return message.content;
  const kwargs = objectRecord(message.kwargs);
  if ('content' in kwargs) return kwargs.content;
  return undefined;
}

function isOpenBoxResult(content: unknown): boolean {
  const parsed = openBoxResultFromContent(content);
  return Boolean(parsed);
}

function openBoxResultFromContent(content: unknown): Record<string, unknown> | null {
  const parsed = parseContent(content);
  if (!isRecord(parsed)) return null;
  if (parsed.schemaVersion !== OPENBOX_COPILOTKIT_RESULT_SCHEMA_VERSION)
    return null;
  return (
    OPENBOX_RESULT_STATUSES.has(String(parsed.status)) ||
    parsed.verdict === 'halt' ||
    parsed.verdict === 'block' ||
    parsed.verdict === 'error'
  )
    ? parsed
    : null;
}

function isApprovalRequiredResult(result: Record<string, unknown>): boolean {
  const status = String(result.status ?? '');
  const verdict = String(result.verdict ?? '');
  return (
    status === 'approval_required' ||
    status === 'approval_pending' ||
    verdict === 'require_approval'
  );
}

// halt / block / error are workflow-terminal: the runtime stops governance and
// suppresses further events, so the governed card is the final answer and the
// model should NOT continue. Allow / executed / constrained are non-terminal and
// the model continues to emit a one-sentence confirmation.
function isTerminalGovernedResult(result: Record<string, unknown>): boolean {
  const status = String(result.status ?? '');
  const verdict = String(result.verdict ?? '');
  return (
    status === 'halted' ||
    status === 'blocked' ||
    status === 'error' ||
    verdict === 'halt' ||
    verdict === 'block' ||
    verdict === 'error'
  );
}

function approvalReviewArgs(
  result: Record<string, unknown>,
): Record<string, unknown> {
  return compactObject({
    action: stringValue(result.action),
    request: stringValue(result.request),
    destination: stringValue(result.destination),
    amountUsd:
      typeof result.amountUsd === 'number' ? result.amountUsd : undefined,
    riskReason: stringValue(result.reason ?? result.message),
    workflowId: stringValue(result.workflowId),
    runId: stringValue(result.runId),
    activityId: stringValue(result.activityId),
    approvalId: stringValue(result.approvalId),
    governanceEventId: stringValue(result.governanceEventId),
    expiresAt: stringValue(result.expiresAt),
  });
}

function openBoxApprovalResponse(content: unknown): Record<string, unknown> | null {
  const parsed = parseContent(content);
  if (!isRecord(parsed)) return null;
  const nextTool = String(parsed.nextTool ?? '');
  const mustResume = parsed.mustCallOpenBoxResumeGovernedAction === true;
  if (nextTool !== 'openbox_resume_governed_action' && !mustResume) {
    return null;
  }
  return compactObject({
    workflowId: stringValue(parsed.workflowId),
    runId: stringValue(parsed.runId),
    activityId: stringValue(parsed.activityId),
    approvalId: stringValue(parsed.approvalId),
    governanceEventId: stringValue(parsed.governanceEventId),
    approved:
      typeof parsed.approved === 'boolean' ? parsed.approved : undefined,
    action: stringValue(parsed.action),
    request: stringValue(parsed.request),
    destination: stringValue(parsed.destination),
    amountUsd:
      typeof parsed.amountUsd === 'number' ? parsed.amountUsd : undefined,
    fields: Array.isArray(parsed.fields) ? parsed.fields : undefined,
    audience: stringValue(parsed.audience),
    manualInput: stringValue(parsed.manualInput),
    sensitivity: stringValue(parsed.sensitivity),
    choiceId: stringValue(parsed.choiceId),
  });
}

function compactObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => {
      if (value === undefined || value === null) return false;
      if (typeof value === 'string' && value.length === 0) return false;
      return true;
    }),
  );
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parseContent(content: unknown): unknown {
  if (isRecord(content)) return content;
  if (typeof content === 'string') {
    try {
      return JSON.parse(content);
    } catch {
      return undefined;
    }
  }
  if (Array.isArray(content)) {
    for (const part of content) {
      const record = objectRecord(part);
      const parsed = parseContent(record.text ?? record.content);
      if (parsed !== undefined) return parsed;
    }
  }
  return undefined;
}
