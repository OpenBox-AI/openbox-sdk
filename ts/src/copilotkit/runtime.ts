import { randomUUID } from 'node:crypto';
import {
  DEFAULT_AGENT_WORKFLOW_TYPE,
  DEFAULT_TASK_QUEUE,
  OPENBOX_COPILOTKIT_RESULT_SCHEMA_VERSION,
  OPENBOX_RUNTIME_PROMPT_GOVERNED_KEY,
} from './constants.js';
import { PRESET_ACTIVITY_TYPES } from '../core-client/generated/govern.js';
import {
  isRecord,
  mergeMessageContent,
  objectRecord,
  shouldStopForGate,
  summarizeMessages,
} from './internal-utils.js';
import {
  OpenBoxCopilotKitError,
  type OpenBoxCopilotActionResult,
  type OpenBoxCopilotAgentRunnerLike,
  type OpenBoxCopilotKitAdapter,
  type OpenBoxCopilotObservableLike,
  type OpenBoxCopilotRunnerRunRequest,
  type OpenBoxCopilotRunInputLike,
  type OpenBoxCopilotRuntime,
  type OpenBoxCopilotRuntimeConfig,
  type OpenBoxCopilotRuntimeErrorHookContext,
  type OpenBoxCopilotRuntimeHookContext,
  type OpenBoxCopilotRuntimeResponseHookContext,
} from './types.js';
import { completeWorkflow, failWorkflow } from './workflow-session.js';

const langchainActivity = PRESET_ACTIVITY_TYPES.langchain;

type AdapterFactory = () => OpenBoxCopilotKitAdapter;

export function createOpenBoxCopilotRuntime(
  config: OpenBoxCopilotRuntimeConfig,
  defaultAdapter: AdapterFactory,
): OpenBoxCopilotRuntime {
  const adapter = config.adapter ?? defaultAdapter();
  const baseRunner = config.runner ?? config.runtime.runner;
  if (!baseRunner?.run) {
    throw new OpenBoxCopilotKitError(
      'CopilotKit runtime runner is required for OpenBox native runtime governance.',
    );
  }
  const governedRunner = createOpenBoxGovernedRunner(
    baseRunner,
    {
      adapter,
      agents: config.agents,
      sessionKey: config.sessionKey,
    },
    defaultAdapter,
  );
  const runtime = Object.create(config.runtime);
  Object.defineProperty(runtime, 'runner', {
    value: governedRunner,
    enumerable: true,
    configurable: true,
  });
  return {
    runtime,
    runner: governedRunner,
    hooks: createOpenBoxRuntimeHooks(
      {
        adapter,
        agents: config.agents,
      },
      defaultAdapter,
    ),
  };
}

export function createOpenBoxGovernedRunner(
  runner: OpenBoxCopilotAgentRunnerLike,
  config: {
    adapter?: OpenBoxCopilotKitAdapter;
    agents?: string[];
    sessionKey?: (input: OpenBoxCopilotRunInputLike) => string;
  } = {},
  defaultAdapter: AdapterFactory,
): OpenBoxCopilotAgentRunnerLike {
  const adapter = config.adapter ?? defaultAdapter();
  const agentSet = config.agents ? new Set(config.agents) : undefined;
  const sessionKeyForInput =
    config.sessionKey ?? ((input) => input.threadId || 'default');
  const governedRunner = Object.create(Object.getPrototypeOf(runner));
  Object.defineProperties(governedRunner, {
    run: {
      value(request: OpenBoxCopilotRunnerRunRequest) {
        // CopilotKit's SSE handler calls runner.run({ threadId, agent, input })
        // without an agentId field, so resolve the id from the agent object
        // too. When no id can be determined, govern anyway (fail closed)
        // instead of silently bypassing OpenBox.
        const agentRecord = objectRecord(request.agent);
        const agentId =
          typeof request.agentId === 'string'
            ? request.agentId
            : typeof agentRecord.agentId === 'string'
              ? agentRecord.agentId
              : typeof agentRecord.name === 'string'
                ? agentRecord.name
                : typeof agentRecord.id === 'string'
                  ? agentRecord.id
                  : undefined;
        if (agentSet && agentId && !agentSet.has(agentId)) {
          return runner.run(request);
        }
        return createDeferredObservable(runner, async (subscriber) => {
          const sessionKey = sessionKeyForInput(request.input);
          const governedInput = isRuntimePromptGoverned(request.input)
            ? request.input
            : await governRunPrompt(
                adapter,
                request.input,
                sessionKey,
                subscriber,
              );
          if (!governedInput) return;
          const source = runner.run({ ...request, input: governedInput });
          pipeGovernedEvents(
            source,
            subscriber,
            adapter,
            sessionKey,
            governedInput,
            runtimeWorkflowConfig(adapter),
          );
        });
      },
      writable: true,
      enumerable: true,
      configurable: true,
    },
    connect: {
      value: runner.connect?.bind(runner),
      writable: true,
      enumerable: true,
      configurable: true,
    },
    isRunning: {
      value: runner.isRunning?.bind(runner),
      writable: true,
      enumerable: true,
      configurable: true,
    },
    stop: {
      value: runner.stop?.bind(runner),
      writable: true,
      enumerable: true,
      configurable: true,
    },
  });
  return governedRunner;
}

export function createOpenBoxRuntimeHooks(
  config: {
    adapter?: OpenBoxCopilotKitAdapter;
    agents?: string[];
  } = {},
  defaultAdapter: AdapterFactory,
) {
  const adapter = config.adapter ?? defaultAdapter();
  const agentSet = config.agents ? new Set(config.agents) : undefined;
  return {
    async onBeforeHandler(
      ctx: OpenBoxCopilotRuntimeHookContext,
    ): Promise<Request | void> {
      if (ctx.route?.method !== 'agent/run') return;
      const agentId =
        typeof ctx.route.agentId === 'string' ? ctx.route.agentId : undefined;
      if (agentSet && (!agentId || !agentSet.has(agentId))) return;
      if (!adapter.isEnabled()) return;
      const body = await readJsonRequestBody(ctx.request);
      if (!isRecord(body)) return;
      const input = body as OpenBoxCopilotRunInputLike;
      const sessionKey = input.threadId || 'default';
      const ids = freshRuntimeWorkflowIdsFromInput(input);
      const promptGate = await adapter.governPrompt({
        payload: { messages: summarizeMessages(input.messages ?? []) },
        sessionKey,
        workflowId: ids.workflowId,
        runId: ids.runId,
        activityType: langchainActivity.onChatModelStart,
        ensureWorkflowStarted: true,
      });
      if (shouldStopForGate(promptGate)) {
        throw openBoxSseResponse(
          input,
          adapter.toOpenBoxCopilotResult(promptGate.verdict, promptGate),
        );
      }
      const governedInput = markRuntimePromptGoverned(
        withOpenBoxRuntimeIds(
          withGovernedRunInput(input, promptGate.safe, promptGate.changed),
          ids,
        ),
      );
      return jsonRequestWithBody(ctx.request, governedInput);
    },
    async onResponse(
      ctx: OpenBoxCopilotRuntimeResponseHookContext,
    ): Promise<Response | void> {
      if (ctx.route?.method !== 'agent/run') return;
      return undefined;
    },
    async onError(
      ctx: OpenBoxCopilotRuntimeErrorHookContext,
    ): Promise<Response | void> {
      if (ctx.error instanceof OpenBoxCopilotKitError) {
        return new Response(JSON.stringify({ error: ctx.error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return undefined;
    },
  };
}

async function readJsonRequestBody(request: Request): Promise<unknown> {
  try {
    return await request.clone().json();
  } catch {
    return undefined;
  }
}

function jsonRequestWithBody(request: Request, body: unknown): Request {
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(body),
    redirect: request.redirect,
    credentials: request.credentials,
    cache: request.cache,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    integrity: request.integrity,
    keepalive: request.keepalive,
    signal: request.signal,
  });
}

function createDeferredObservable(
  runner: OpenBoxCopilotAgentRunnerLike,
  start: (subscriber: OpenBoxSubscriberLike) => Promise<void>,
): OpenBoxCopilotObservableLike {
  return {
    subscribe(observerOrNext?: unknown, error?: unknown, complete?: unknown) {
      const subscriber = normalizeSubscriber(observerOrNext, error, complete);
      start(subscriber).catch((err) => subscriber.error?.(err));
      return { unsubscribe() {} };
    },
  };
}

interface OpenBoxSubscriberLike {
  next?(value: unknown): void;
  error?(error: unknown): void;
  complete?(): void;
}

type FinalPayloadLocation = {
  field: string;
  payload: unknown;
};

async function governRunPrompt(
  adapter: OpenBoxCopilotKitAdapter,
  input: OpenBoxCopilotRunInputLike,
  sessionKey: string,
  subscriber: OpenBoxSubscriberLike,
): Promise<OpenBoxCopilotRunInputLike | undefined> {
  const promptGate = await adapter.governPrompt({
    payload: { messages: summarizeMessages(input.messages ?? []) },
    sessionKey,
    ...freshRuntimeWorkflowIdsFromInput(input),
    activityType: langchainActivity.onChatModelStart,
    ensureWorkflowStarted: true,
  });
  if (shouldStopForGate(promptGate)) {
    emitOpenBoxRunResult(
      subscriber,
      input,
      adapter.toOpenBoxCopilotResult(promptGate.verdict, promptGate),
    );
    return undefined;
  }
  return withOpenBoxRuntimeIds(
    withGovernedRunInput(input, promptGate.safe, promptGate.changed),
    { workflowId: promptGate.workflowId, runId: promptGate.runId },
  );
}

function normalizeSubscriber(
  observerOrNext?: unknown,
  error?: unknown,
  complete?: unknown,
): OpenBoxSubscriberLike {
  if (typeof observerOrNext === 'function') {
    return {
      next: observerOrNext as (value: unknown) => void,
      error:
        typeof error === 'function'
          ? (error as (err: unknown) => void)
          : undefined,
      complete:
        typeof complete === 'function' ? (complete as () => void) : undefined,
    };
  }
  if (isRecord(observerOrNext)) {
    return observerOrNext as OpenBoxSubscriberLike;
  }
  return {};
}

function pipeGovernedEvents(
  source: OpenBoxCopilotObservableLike,
  subscriber: OpenBoxSubscriberLike,
  adapter: OpenBoxCopilotKitAdapter,
  sessionKey: string,
  input: OpenBoxCopilotRunInputLike,
  workflowConfig: { workflowType: string; taskQueue: string },
) {
  const pending: Promise<void>[] = [];
  const ids = runtimeWorkflowIdsFromInput(input);
  let terminalized = false;
  let pendingError: unknown;
  let queuedTerminalEvent:
    | {
        event: Record<string, any>;
        kind: 'completed' | 'failed';
        error?: unknown;
      }
    | undefined;
  let terminalFlushScheduled = false;
  const markCompleted = async () => {
    if (terminalized) return;
    terminalized = true;
    await completeWorkflow(
      adapter,
      ids,
      workflowConfig.workflowType,
      workflowConfig.taskQueue,
    );
  };
  const markFailed = async (error: unknown) => {
    if (terminalized) return;
    terminalized = true;
    await failWorkflow(
      adapter,
      ids,
      workflowConfig.workflowType,
      workflowConfig.taskQueue,
      error,
    );
  };
  const queuePending = (promise: Promise<void>) => {
    pending.push(
      promise.catch(async (error) => {
        pendingError = error;
        await markFailed(error);
        subscriber.error?.(error);
      }),
    );
  };
  // CopilotKit's SSE layer ends the stream after RUN_FINISHED/RUN_ERROR.
  // Delay terminal run events until queued OpenBox output gates have emitted
  // their transformed messages; otherwise the client drops post-finish events.
  const queueTerminalEvent = (
    event: Record<string, any>,
    kind: 'completed' | 'failed',
    error?: unknown,
  ) => {
    queuedTerminalEvent = { event, kind, error };
    if (terminalFlushScheduled) return;
    terminalFlushScheduled = true;
    setTimeout(() => {
      terminalFlushScheduled = false;
      void flushQueuedTerminalEvent().catch(async (flushError) => {
        pendingError = flushError;
        await markFailed(flushError);
        subscriber.error?.(flushError);
      });
    }, 0);
  };
  const waitForPendingGates = async () => {
    let settled = 0;
    while (settled < pending.length) {
      const snapshot = pending.slice(settled);
      settled = pending.length;
      await Promise.allSettled(snapshot);
    }
  };
  const flushQueuedTerminalEvent = async () => {
    if (!queuedTerminalEvent) return;
    const terminal = queuedTerminalEvent;
    queuedTerminalEvent = undefined;
    await waitForPendingGates();
    if (terminal.kind === 'failed') {
      emit(terminal.event);
      await markFailed(terminal.error);
      return;
    }
    if (!pendingError) {
      emit(terminal.event);
      await markCompleted();
    }
  };
  const assistantBuffers = new Map<
    string,
    {
      start?: Record<string, any>;
      content: string;
      end?: Record<string, any>;
    }
  >();
  const emit = (event: unknown) => subscriber.next?.(event);
  const subscription = source.subscribe({
    next(event: unknown) {
      if (!isRecord(event)) {
        emit(event);
        return;
      }
      const agEvent = event as Record<string, any>;
      const type = String(agEvent.type);
      if (isAssistantTextStart(agEvent)) {
        assistantBuffers.set(messageIdForEvent(agEvent), {
          start: agEvent,
          content: '',
        });
        return;
      }
      if (isAssistantTextContent(agEvent)) {
        const messageId = messageIdForEvent(agEvent);
        const buffer = assistantBuffers.get(messageId);
        if (!buffer) {
          emit(agEvent);
          return;
        }
        buffer.content += String(agEvent.delta ?? agEvent.content ?? '');
        return;
      }
      // Governed tools terminate or intentionally leave the shared task
      // workflow open (halt/block/approval). When their result says so, the
      // runtime must not send its own WorkflowCompleted on RUN_FINISHED.
      if (isToolResultEvent(agEvent) && governedResultEndsWorkflow(agEvent)) {
        terminalized = true;
        emit(agEvent);
        return;
      }
      if (isAssistantTextEnd(agEvent)) {
        const messageId = messageIdForEvent(agEvent);
        const buffer = assistantBuffers.get(messageId);
        if (!buffer) {
          emit(agEvent);
          return;
        }
        buffer.end = agEvent;
        assistantBuffers.delete(messageId);
        if (terminalized) {
          emit(buffer.start);
          emit({
            ...contentEventFromStart(buffer.start, buffer.content),
            type: contentEventType(type),
          });
          emit(buffer.end);
          return;
        }
        queuePending(
          (async () => {
            const gate = await adapter.governAssistantOutput({
              payload: { content: buffer.content },
              sessionKey,
              ...ids,
              activityType: langchainActivity.onLlmEnd,
            });
            if (shouldStopForGate(gate)) {
              terminalized = true;
              emitOpenBoxMessageEvents(
                subscriber,
                input,
                adapter.toOpenBoxCopilotResult(gate.verdict, gate),
                messageId,
              );
              return;
            }
            const safeContent = contentFromSafePayload(
              gate.safe,
              buffer.content,
            );
            emit(buffer.start);
            emit({
              ...contentEventFromStart(buffer.start, safeContent),
              type: contentEventType(type),
            });
            emit(buffer.end);
          })(),
        );
        return;
      }
      const finalPayload = finalPayloadLocationForEvent(agEvent);
      if (finalPayload) {
        queuePending(
          (async () => {
            const gate = await adapter.governAssistantOutput({
              payload: finalPayload.payload,
              sessionKey,
              ...ids,
              activityType: langchainActivity.onLlmEnd,
            });
            if (shouldStopForGate(gate)) {
              terminalized = true;
              emitOpenBoxMessageEvents(
                subscriber,
                input,
                adapter.toOpenBoxCopilotResult(gate.verdict, gate),
              );
              if (isRunFinishedEvent(agEvent)) {
                queueTerminalEvent(
                  runFinishedWithoutFinalPayload(agEvent, finalPayload),
                  'completed',
                );
              }
              return;
            }
            const safeEvent = eventWithSafeFinalPayload(
              agEvent,
              finalPayload,
              gate.safe,
            );
            if (isRunFinishedEvent(agEvent)) {
              queueTerminalEvent(safeEvent, 'completed');
              return;
            }
            emit(safeEvent);
          })(),
        );
        return;
      }
      if (isRunFinishedEvent(agEvent)) {
        queueTerminalEvent(agEvent, 'completed');
        return;
      }
      if (isRunErrorEvent(agEvent)) {
        queueTerminalEvent(
          agEvent,
          'failed',
          new Error(
            typeof agEvent.message === 'string'
              ? agEvent.message
              : 'CopilotKit run error',
          ),
        );
        return;
      }
      emit(agEvent);
    },
    error(error: unknown) {
      Promise.allSettled(pending)
        .then(() => markFailed(error))
        .then(
          () => subscriber.error?.(error),
          () => subscriber.error?.(error),
        );
    },
    complete() {
      waitForPendingGates().then(
        async () => {
          if (pendingError) return;
          await flushQueuedTerminalEvent();
          if (pendingError) return;
          await markCompleted();
          subscriber.complete?.();
        },
        (error) => subscriber.error?.(error),
      );
    },
  } as any);
  return subscription;
}

function runtimeWorkflowConfig(adapter: OpenBoxCopilotKitAdapter): {
  workflowType: string;
  taskQueue: string;
} {
  const config = (adapter as unknown as {
    __openboxCopilotRuntimeConfig?: {
      workflowType?: unknown;
      taskQueue?: unknown;
    };
  }).__openboxCopilotRuntimeConfig;
  return {
    workflowType:
      typeof config?.workflowType === 'string'
        ? config.workflowType
        : DEFAULT_AGENT_WORKFLOW_TYPE,
    taskQueue:
      typeof config?.taskQueue === 'string'
        ? config.taskQueue
        : DEFAULT_TASK_QUEUE,
  };
}

function isAssistantTextStart(event: Record<string, any>): boolean {
  const type = String(event.type);
  return (
    (type === 'TEXT_MESSAGE_START' || type === 'TextMessageStart') &&
    String(event.role ?? 'assistant') === 'assistant'
  );
}

function isAssistantTextContent(event: Record<string, any>): boolean {
  const type = String(event.type);
  return (
    type === 'TEXT_MESSAGE_CONTENT' ||
    type === 'TEXT_MESSAGE_CHUNK' ||
    type === 'TextMessageContent' ||
    type === 'TextMessageChunk'
  );
}

function isAssistantTextEnd(event: Record<string, any>): boolean {
  const type = String(event.type);
  return type === 'TEXT_MESSAGE_END' || type === 'TextMessageEnd';
}

function isRunFinishedEvent(event: Record<string, any>): boolean {
  const type = String(event.type);
  return type === 'RUN_FINISHED' || type === 'RunFinished';
}

function isRunErrorEvent(event: Record<string, any>): boolean {
  const type = String(event.type);
  return type === 'RUN_ERROR' || type === 'RunError';
}

function isToolResultEvent(event: Record<string, any>): boolean {
  const type = String(event.type);
  return type === 'TOOL_CALL_RESULT' || type === 'ToolCallResult';
}

const WORKFLOW_ENDING_RESULT_STATUSES = new Set([
  'blocked',
  'halted',
  'rejected',
  'error',
  'approval_required',
  'approval_pending',
]);

function governedResultEndsWorkflow(event: Record<string, any>): boolean {
  const content = event.content;
  if (typeof content !== 'string') return false;
  try {
    const parsed = JSON.parse(content);
    return (
      isRecord(parsed) &&
      parsed.schemaVersion === OPENBOX_COPILOTKIT_RESULT_SCHEMA_VERSION &&
      WORKFLOW_ENDING_RESULT_STATUSES.has(String(parsed.status))
    );
  } catch {
    return false;
  }
}

function finalPayloadLocationForEvent(
  event: Record<string, any>,
): FinalPayloadLocation | undefined {
  if (!isFinalOutputEvent(event)) return undefined;
  for (const field of ['output', 'result', 'data', 'payload', 'message']) {
    if (event[field] !== undefined && event[field] !== null) {
      return { field, payload: event[field] };
    }
  }
  return undefined;
}

function isFinalOutputEvent(event: Record<string, any>): boolean {
  const type = String(event.type);
  if (type === 'RUN_FINISHED' || type === 'RunFinished') {
    return true;
  }
  if (
    type !== 'CUSTOM' &&
    type !== 'CUSTOM_EVENT' &&
    type !== 'CustomEvent'
  ) {
    return false;
  }
  if (event.final === true || event.isFinal === true) return true;
  const name = String(event.name ?? event.event ?? '').toLowerCase();
  return name.includes('assistant_final') || name.includes('final_output');
}

function eventWithSafeFinalPayload(
  event: Record<string, any>,
  location: FinalPayloadLocation,
  safe: unknown,
): Record<string, any> {
  return {
    ...event,
    [location.field]: finalPayloadFromSafe(safe, location.payload),
  };
}

function runFinishedWithoutFinalPayload(
  event: Record<string, any>,
  location: FinalPayloadLocation,
): Record<string, any> {
  const safeEvent = { ...event };
  delete safeEvent[location.field];
  return safeEvent;
}

function finalPayloadFromSafe(safe: unknown, original: unknown): unknown {
  if (
    typeof original === 'string' &&
    isRecord(safe) &&
    typeof safe.content === 'string'
  ) {
    return safe.content;
  }
  return safe;
}

function messageIdForEvent(event: Record<string, any>): string {
  return String(event.messageId ?? event.id ?? 'openbox-message');
}

function contentEventType(endType: string): string {
  return endType.startsWith('Text')
    ? 'TextMessageContent'
    : 'TEXT_MESSAGE_CONTENT';
}

function contentEventFromStart(
  start: Record<string, any> | undefined,
  content: string,
): Record<string, any> {
  return {
    messageId:
      start?.messageId ?? start?.id ?? `openbox_message_${randomUUID()}`,
    delta: content,
  };
}

function contentFromSafePayload(safe: unknown, defaultContent: string): string {
  if (typeof safe === 'string') return safe;
  if (isRecord(safe) && typeof safe.content === 'string') return safe.content;
  return defaultContent;
}

function withGovernedRunInput(
  input: OpenBoxCopilotRunInputLike,
  safe: unknown,
  changed = true,
): OpenBoxCopilotRunInputLike {
  if (!changed) return input;
  if (isRecord(safe) && Array.isArray(safe.messages)) {
    return {
      ...input,
      messages: mergeMessageContent(input.messages, safe.messages) as Array<
        Record<string, any>
      >,
    };
  }
  return input;
}

function isRuntimePromptGoverned(input: OpenBoxCopilotRunInputLike): boolean {
  return (
    isRecord(input.state) &&
    (input.state as Record<string, unknown>)[
      OPENBOX_RUNTIME_PROMPT_GOVERNED_KEY
    ] === true
  );
}

function markRuntimePromptGoverned(
  input: OpenBoxCopilotRunInputLike,
): OpenBoxCopilotRunInputLike {
  const state = isRecord(input.state)
    ? (input.state as Record<string, unknown>)
    : {};
  return {
    ...input,
    state: {
      ...state,
      [OPENBOX_RUNTIME_PROMPT_GOVERNED_KEY]: true,
    },
  };
}

function runtimeWorkflowIdsFromInput(input: OpenBoxCopilotRunInputLike): {
  workflowId: string;
  runId: string;
} {
  const state = isRecord(input.state)
    ? (input.state as Record<string, unknown>)
    : {};
  const openboxSession = isRecord(state.openboxSession)
    ? (state.openboxSession as Record<string, unknown>)
    : {};
  const workflowId =
    typeof openboxSession.workflowId === 'string'
      ? openboxSession.workflowId
      : typeof state.openboxWorkflowId === 'string'
        ? state.openboxWorkflowId
        : randomUUID();
  const candidateRunId =
    typeof openboxSession.runId === 'string'
      ? openboxSession.runId
      : typeof state.openboxRunId === 'string'
        ? state.openboxRunId
        : typeof input.runId === 'string'
          ? input.runId
          : randomUUID();
  return {
    workflowId,
    runId: candidateRunId === workflowId ? randomUUID() : candidateRunId,
  };
}

function freshRuntimeWorkflowIdsFromInput(input: OpenBoxCopilotRunInputLike): {
  workflowId: string;
  runId: string;
} {
  const workflowId = randomUUID();
  const runId =
    typeof input.runId === 'string' && input.runId !== workflowId
      ? input.runId
      : randomUUID();
  return { workflowId, runId };
}

function withOpenBoxRuntimeIds(
  input: OpenBoxCopilotRunInputLike,
  ids: { workflowId: string; runId: string },
): OpenBoxCopilotRunInputLike {
  const state = isRecord(input.state)
    ? (input.state as Record<string, unknown>)
    : {};
  const openboxSession = isRecord(state.openboxSession)
    ? (state.openboxSession as Record<string, unknown>)
    : {};
  // AG-UI forwards run-config `configurable` keys that match the agent's
  // context schema into LangGraph run context. That is the reliable channel
  // for handing the task workflow IDs to the agent process; state keys are
  // filtered by the graph input schema.
  const forwardedProps = objectRecord(input.forwardedProps);
  const forwardedConfig = objectRecord(forwardedProps.config);
  const forwardedConfigurable = objectRecord(forwardedConfig.configurable);
  return {
    ...input,
    forwardedProps: {
      ...forwardedProps,
      config: {
        ...forwardedConfig,
        configurable: {
          ...forwardedConfigurable,
          openboxWorkflowId: ids.workflowId,
          openboxRunId: ids.runId,
          openboxPromptGoverned: true,
        },
      },
    },
    state: {
      ...state,
      openboxWorkflowId: ids.workflowId,
      openboxRunId: ids.runId,
      openboxSession: {
        status:
          typeof openboxSession.status === 'string'
            ? openboxSession.status
            : 'active',
        ...openboxSession,
        workflowId: ids.workflowId,
        runId: ids.runId,
      },
    },
  };
}

function emitOpenBoxRunResult(
  subscriber: OpenBoxSubscriberLike,
  input: OpenBoxCopilotRunInputLike,
  result: OpenBoxCopilotActionResult,
) {
  const runId = input.runId ?? randomUUID();
  subscriber.next?.({
    type: 'RUN_STARTED',
    threadId: input.threadId,
    runId,
    input,
  });
  emitOpenBoxMessageEvents(subscriber, input, result);
  subscriber.next?.({
    type: 'RUN_FINISHED',
    threadId: input.threadId,
    runId,
  });
  subscriber.complete?.();
}

function emitOpenBoxMessageEvents(
  subscriber: OpenBoxSubscriberLike,
  _input: OpenBoxCopilotRunInputLike,
  result: OpenBoxCopilotActionResult,
  messageId = `openbox_message_${randomUUID()}`,
) {
  const toolCallId = `openbox_runtime_gate_${randomUUID().replace(/-/g, '')}`;
  const content = JSON.stringify(result);
  subscriber.next?.({
    type: 'TOOL_CALL_START',
    toolCallId,
    toolCallName: 'openbox_governed_action',
  });
  subscriber.next?.({
    type: 'TOOL_CALL_ARGS',
    toolCallId,
    delta: JSON.stringify({
      action: result.action,
      request: result.request,
      destination: result.destination,
      amountUsd: result.amountUsd,
      fields: result.fields,
      audience: result.audience,
      sensitivity: result.sensitivity,
    }),
  });
  subscriber.next?.({
    type: 'TOOL_CALL_END',
    toolCallId,
  });
  subscriber.next?.({
    type: 'TOOL_CALL_RESULT',
    messageId,
    toolCallId,
    content,
    role: 'tool',
  });
}

function openBoxSseResponse(
  input: OpenBoxCopilotRunInputLike,
  result: OpenBoxCopilotActionResult,
): Response {
  const events: Record<string, unknown>[] = [];
  const subscriber: OpenBoxSubscriberLike = {
    next: (event) => events.push(event as Record<string, unknown>),
  };
  emitOpenBoxRunResult(subscriber, input, result);
  const body = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join('');
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}
