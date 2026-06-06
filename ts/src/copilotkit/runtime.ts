import { randomUUID } from 'node:crypto';
import { OPENBOX_RUNTIME_PROMPT_GOVERNED_KEY } from './constants.js';
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
  type OpenBoxCopilotRunInputLike,
  type OpenBoxCopilotRuntime,
  type OpenBoxCopilotRuntimeConfig,
  type OpenBoxCopilotRuntimeErrorHookContext,
  type OpenBoxCopilotRuntimeHookContext,
  type OpenBoxCopilotRuntimeResponseHookContext,
} from './types.js';

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
  return {
    run(request) {
      const agentId =
        typeof request.agentId === 'string' ? request.agentId : undefined;
      if (agentSet && (!agentId || !agentSet.has(agentId))) {
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
        );
      });
    },
    connect: runner.connect?.bind(runner),
    isRunning: runner.isRunning?.bind(runner),
    stop: runner.stop?.bind(runner),
  };
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
      const ids = runtimeWorkflowIdsFromInput(input);
      const promptGate = await adapter.governPrompt({
        payload: { messages: summarizeMessages(input.messages ?? []) },
        sessionKey,
        workflowId: ids.workflowId,
        runId: ids.runId,
        activityType: 'on_chat_model_start',
        ensureWorkflowStarted: true,
      });
      if (shouldStopForGate(promptGate, 'enforce')) {
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
    ...runtimeWorkflowIdsFromInput(input),
    activityType: 'on_chat_model_start',
    ensureWorkflowStarted: true,
  });
  if (shouldStopForGate(promptGate, 'enforce')) {
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
) {
  const pending: Promise<void>[] = [];
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
      if (isAssistantTextEnd(agEvent)) {
        const messageId = messageIdForEvent(agEvent);
        const buffer = assistantBuffers.get(messageId);
        if (!buffer) {
          emit(agEvent);
          return;
        }
        buffer.end = agEvent;
        assistantBuffers.delete(messageId);
        pending.push(
          (async () => {
            const gate = await adapter.governAssistantOutput({
              payload: { content: buffer.content },
              sessionKey,
              ...runtimeWorkflowIdsFromInput(input),
              activityType: 'on_llm_end',
            });
            if (shouldStopForGate(gate, 'enforce')) {
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
          })().catch((error) => subscriber.error?.(error)),
        );
        return;
      }
      const finalPayload = finalPayloadLocationForEvent(agEvent);
      if (finalPayload) {
        pending.push(
          (async () => {
            const gate = await adapter.governAssistantOutput({
              payload: finalPayload.payload,
              sessionKey,
              ...runtimeWorkflowIdsFromInput(input),
              activityType: 'on_llm_end',
            });
            if (shouldStopForGate(gate, 'enforce')) {
              emitOpenBoxMessageEvents(
                subscriber,
                input,
                adapter.toOpenBoxCopilotResult(gate.verdict, gate),
              );
              return;
            }
            emit(eventWithSafeFinalPayload(agEvent, finalPayload, gate.safe));
          })().catch((error) => subscriber.error?.(error)),
        );
        return;
      }
      emit(agEvent);
    },
    error(error: unknown) {
      subscriber.error?.(error);
    },
    complete() {
      Promise.all(pending).then(
        () => subscriber.complete?.(),
        (error) => subscriber.error?.(error),
      );
    },
  } as any);
  return subscription;
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

function contentFromSafePayload(safe: unknown, fallback: string): string {
  if (typeof safe === 'string') return safe;
  if (isRecord(safe) && typeof safe.content === 'string') return safe.content;
  return fallback;
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
  return {
    ...input,
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
  input: OpenBoxCopilotRunInputLike,
  result: OpenBoxCopilotActionResult,
  messageId = `openbox_message_${randomUUID()}`,
) {
  const content = JSON.stringify(result);
  subscriber.next?.({
    type: 'TEXT_MESSAGE_START',
    messageId,
    role: 'assistant',
  });
  subscriber.next?.({
    type: 'TEXT_MESSAGE_CONTENT',
    messageId,
    delta: content,
  });
  subscriber.next?.({
    type: 'TEXT_MESSAGE_END',
    messageId,
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
