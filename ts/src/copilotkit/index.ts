import { randomBytes, randomUUID } from 'node:crypto';
import {
  OpenBoxCoreClient,
  type GovernanceEventPayload,
  type SpanData,
} from '../core-client/core-client.js';
import {
  applyInputRedaction,
  applyOutputRedaction,
  hasGuardrailRedaction,
  summarizeGuardrailRedaction,
} from '../core-client/redaction.js';
import {
  govern,
  presets,
  type BaseGovernedSession,
  type GuardrailsVerdict,
  type WorkflowVerdict,
} from '../core-client/index.js';
import { OpenBoxClient } from '../client/index.js';
import { decideApproval } from '../approvals/index.js';

const DEFAULT_WORKFLOW_TYPE = 'CopilotKitGovernedAction';
const DEFAULT_AGENT_WORKFLOW_TYPE = 'CopilotKitAgent';
const DEFAULT_TASK_QUEUE = 'copilotkit';
const OPENBOX_RUNTIME_KEY_PATTERN = /^obx_(live|test)_/;
const OPENBOX_RUNTIME_PROMPT_GOVERNED_KEY = '__openboxRuntimePromptGoverned';
export const OPENBOX_COPILOTKIT_RESULT_SCHEMA_VERSION = 'openbox.copilotkit.result.v1' as const;

export type OpenBoxCopilotVerdictStatus =
  | 'executed'
  | 'constrained'
  | 'blocked'
  | 'halted'
  | 'session_halted'
  | 'approval_required'
  | 'rejected'
  | 'approval_pending'
  | 'error';

export type OpenBoxCopilotSessionState =
  | { status: 'active' }
  | {
      status: 'halted';
      reason: string;
      haltedAt: string;
      workflowId?: string;
      runId?: string;
      activityId?: string;
    };

export interface OpenBoxCopilotActionInput {
  action: string;
  request: string;
  destination?: string;
  amountUsd?: number;
  fields?: string[];
  audience?: string;
  sensitivity?: string;
  [key: string]: unknown;
}

export interface OpenBoxCopilotResumeInput extends OpenBoxCopilotActionInput {
  workflowId: string;
  runId: string;
  activityId: string;
  approvalId?: string;
  governanceEventId?: string;
  approved?: boolean;
}

export interface OpenBoxCopilotActionResult<TArtifact = unknown> {
  schemaVersion: typeof OPENBOX_COPILOTKIT_RESULT_SCHEMA_VERSION;
  status: OpenBoxCopilotVerdictStatus;
  verdict: WorkflowVerdict['arm'];
  executed: boolean;
  action: string;
  request: string;
  destination: string | null;
  amountUsd: number | null;
  fields: string[] | null;
  audience: string | null;
  sensitivity: string | null;
  reason: string;
  message: string;
  riskScore?: number;
  trustTier?: string | number;
  guardrailsResult?: WorkflowVerdict['guardrailsResult'];
  redactionSummary?: string;
  artifact?: TArtifact;
  workflowId?: string;
  runId?: string;
  activityId?: string;
  approvalId?: string;
  governanceEventId?: string;
  expiresAt?: string;
  session?: OpenBoxCopilotSessionState;
  [key: string]: unknown;
}

export interface OpenBoxCopilotKitConfig {
  enabled?: boolean;
  strict?: boolean;
  governanceMode?: 'observe' | 'enforce';
  failClosed?: boolean;
  redactionMode?: 'transformed-only';
  core?: OpenBoxCoreClient;
  coreUrl?: string;
  apiKey?: string;
  apiUrl?: string;
  platformApiKey?: string;
  agentId?: string;
  clientName?: string;
  workflowType?: string;
  agentWorkflowType?: string;
  taskQueue?: string;
  selfGovernedToolNames?: Iterable<string>;
}

export interface OpenBoxCopilotRuntimeConfig {
  runtime: Record<string, any>;
  runner?: OpenBoxCopilotAgentRunnerLike;
  adapter?: OpenBoxCopilotKitAdapter;
  agents?: string[];
  finalOutputMode?: 'buffer';
  sessionKey?: (input: OpenBoxCopilotRunInputLike) => string;
}

export interface OpenBoxCopilotRuntime {
  runtime: Record<string, any>;
  runner: OpenBoxCopilotAgentRunnerLike;
  hooks: {
    onBeforeHandler(ctx: OpenBoxCopilotRuntimeHookContext): Promise<Request | void>;
    onResponse(ctx: OpenBoxCopilotRuntimeResponseHookContext): Promise<Response | void>;
    onError(ctx: OpenBoxCopilotRuntimeErrorHookContext): Promise<Response | void>;
  };
}

export interface OpenBoxCopilotRuntimeHookContext {
  request: Request;
  path: string;
  runtime: Record<string, any>;
  route?: { method?: string; agentId?: string; [key: string]: unknown };
}

export interface OpenBoxCopilotRuntimeResponseHookContext extends OpenBoxCopilotRuntimeHookContext {
  response: Response;
}

export interface OpenBoxCopilotRuntimeErrorHookContext extends OpenBoxCopilotRuntimeHookContext {
  error: unknown;
}

export interface OpenBoxCopilotAgentRunnerLike {
  run(request: OpenBoxCopilotRunnerRunRequest): OpenBoxCopilotObservableLike;
  connect?(request: unknown): unknown;
  isRunning?(request: unknown): Promise<boolean>;
  stop?(request: unknown): Promise<boolean | undefined>;
}

export interface OpenBoxCopilotRunnerRunRequest {
  threadId: string;
  agent: unknown;
  input: OpenBoxCopilotRunInputLike;
  [key: string]: unknown;
}

export interface OpenBoxCopilotRunInputLike {
  threadId: string;
  runId?: string;
  messages?: Array<Record<string, any>>;
  state?: unknown;
  [key: string]: unknown;
}

export interface OpenBoxCopilotObservableLike {
  subscribe(observerOrNext?: unknown, error?: unknown, complete?: unknown): unknown;
  [key: string]: unknown;
}

export interface OpenBoxCopilotLangChainMiddlewareDeps {
  createMiddleware: (definition: any) => unknown;
  AIMessage: new (message: any) => unknown;
  routeLatestUserPrompt?: (messages: unknown[]) => OpenBoxCopilotPromptRoute | undefined;
}

export interface OpenBoxCopilotPromptRoute {
  toolName: string;
  args: Record<string, unknown>;
}

export type OpenBoxCopilotGateKind =
  | 'prompt'
  | 'tool_input'
  | 'tool_output'
  | 'assistant_output';

export interface OpenBoxSafePayload<T = unknown> {
  safe: T;
  verdict: WorkflowVerdict;
  status: OpenBoxCopilotVerdictStatus;
  changed: boolean;
  rawBlocked: boolean;
  reason: string;
  message: string;
  redactionSummary?: string;
  workflowId: string;
  runId: string;
  activityId: string;
  session?: OpenBoxCopilotSessionState;
}

export interface OpenBoxCopilotGateInput<T = unknown> {
  payload: T;
  sessionKey?: string;
  workflowId?: string;
  runId?: string;
  activityId?: string;
  activityType?: string;
  reason?: string;
}

export interface GovernedCopilotToolDefinition<
  TInput extends OpenBoxCopilotActionInput = OpenBoxCopilotActionInput,
  TArtifact = unknown,
> {
  adapter: OpenBoxCopilotKitAdapter;
  toolName: string;
  description?: string;
  normalizeInput?: (input: TInput) => TInput;
  execute: (input: TInput) => Promise<TArtifact> | TArtifact;
  isArtifactRedacted?: (artifact: TArtifact | undefined) => boolean;
  markArtifactRedacted?: (artifact: TArtifact) => TArtifact;
  sessionKey?: (config?: unknown) => string;
}

export interface OpenBoxApprovalDecisionRequest {
  governanceEventId: string;
  decision: 'approve' | 'reject';
}

export interface OpenBoxApprovalDecisionResult {
  ok: true;
  decision: 'approve' | 'reject';
  eventId?: string;
}

export class OpenBoxCopilotKitError extends Error {
  readonly verdict?: WorkflowVerdict;

  constructor(message: string, verdict?: WorkflowVerdict) {
    super(message);
    this.name = 'OpenBoxCopilotKitError';
    this.verdict = verdict;
  }
}

export interface OpenBoxCopilotKitAdapter {
  isEnabled(): boolean;
  getCoreClient(): OpenBoxCoreClient;
  wrapAgent<TAgent>(agent: TAgent): TAgent;
  createLangChainMiddleware(deps: OpenBoxCopilotLangChainMiddlewareDeps): unknown;
  governPrompt<T = unknown>(input: OpenBoxCopilotGateInput<T>): Promise<OpenBoxSafePayload<T>>;
  governToolInput<T = unknown>(input: OpenBoxCopilotGateInput<T>): Promise<OpenBoxSafePayload<T>>;
  governToolOutput<T = unknown>(input: OpenBoxCopilotGateInput<T>): Promise<OpenBoxSafePayload<T>>;
  governAssistantOutput<T = unknown>(input: OpenBoxCopilotGateInput<T>): Promise<OpenBoxSafePayload<T>>;
  applyOpenBoxTransform<T = unknown>(original: T, verdict: WorkflowVerdict): T;
  toOpenBoxCopilotResult<T = unknown>(
    verdict: WorkflowVerdict,
    safePayload: OpenBoxSafePayload<T>,
  ): OpenBoxCopilotActionResult<T>;
  haltSession(sessionKey: string, session: Extract<OpenBoxCopilotSessionState, { status: 'halted' }>): void;
  isSessionHalted(sessionKey: string): Extract<OpenBoxCopilotSessionState, { status: 'halted' }> | undefined;
  governTool<TInput extends OpenBoxCopilotActionInput, TArtifact>(
    definition: Omit<GovernedCopilotToolDefinition<TInput, TArtifact>, 'adapter'>,
  ): GovernedCopilotTool<TInput, TArtifact>;
  approvalRoute: {
    decide(request: OpenBoxApprovalDecisionRequest): Promise<OpenBoxApprovalDecisionResult>;
  };
  rendering: {
    governedToolNames: string[];
    approvalToolName: string;
    interactiveToolName: string;
    isGovernedToolResult(value: unknown): boolean;
    parseToolResult(value: unknown): Record<string, unknown>;
  };
}

export function createOpenBoxCopilotRuntime(
  config: OpenBoxCopilotRuntimeConfig,
): OpenBoxCopilotRuntime {
  const adapter = config.adapter ?? createOpenBoxCopilotKitAdapter();
  const baseRunner = config.runner ?? config.runtime.runner;
  if (!baseRunner?.run) {
    throw new OpenBoxCopilotKitError(
      'CopilotKit runtime runner is required for OpenBox native runtime governance.',
    );
  }
  const governedRunner = createOpenBoxGovernedRunner(baseRunner, {
    adapter,
    agents: config.agents,
    sessionKey: config.sessionKey,
  });
  const runtime = Object.create(config.runtime);
  Object.defineProperty(runtime, 'runner', {
    value: governedRunner,
    enumerable: true,
    configurable: true,
  });
  return {
    runtime,
    runner: governedRunner,
    hooks: createOpenBoxRuntimeHooks({
      adapter,
      agents: config.agents,
    }),
  };
}

export function createOpenBoxGovernedRunner(
  runner: OpenBoxCopilotAgentRunnerLike,
  config: {
    adapter?: OpenBoxCopilotKitAdapter;
    agents?: string[];
    sessionKey?: (input: OpenBoxCopilotRunInputLike) => string;
  } = {},
): OpenBoxCopilotAgentRunnerLike {
  const adapter = config.adapter ?? createOpenBoxCopilotKitAdapter();
  const agentSet = config.agents ? new Set(config.agents) : undefined;
  const sessionKeyForInput = config.sessionKey ?? ((input) => input.threadId || 'default');
  return {
    run(request) {
      const agentId = typeof request.agentId === 'string' ? request.agentId : undefined;
      if (agentSet && (!agentId || !agentSet.has(agentId))) {
        return runner.run(request);
      }
      return createDeferredObservable(runner, async (subscriber) => {
        const sessionKey = sessionKeyForInput(request.input);
        const governedInput = isRuntimePromptGoverned(request.input)
          ? request.input
          : await governRunPrompt(adapter, request.input, sessionKey, subscriber);
        if (!governedInput) return;
        const source = runner.run({ ...request, input: governedInput });
        pipeGovernedEvents(source, subscriber, adapter, sessionKey, governedInput);
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
) {
  const adapter = config.adapter ?? createOpenBoxCopilotKitAdapter();
  const agentSet = config.agents ? new Set(config.agents) : undefined;
  return {
    async onBeforeHandler(ctx: OpenBoxCopilotRuntimeHookContext): Promise<Request | void> {
      if (ctx.route?.method !== 'agent/run') return;
      const agentId = typeof ctx.route.agentId === 'string' ? ctx.route.agentId : undefined;
      if (agentSet && (!agentId || !agentSet.has(agentId))) return;
      if (!adapter.isEnabled()) return;
      const body = await readJsonRequestBody(ctx.request);
      if (!isRecord(body)) return;
      const input = body as OpenBoxCopilotRunInputLike;
      const sessionKey = input.threadId || 'default';
      const promptGate = await adapter.governPrompt({
        payload: { messages: input.messages ?? [] },
        sessionKey,
        workflowId: input.runId,
        runId: input.runId,
        activityType: 'on_chat_model_start',
      });
      if (shouldStopForGate(promptGate, 'enforce')) {
        throw openBoxSseResponse(input, adapter.toOpenBoxCopilotResult(promptGate.verdict, promptGate));
      }
      const governedInput = markRuntimePromptGoverned(
        withGovernedRunInput(input, promptGate.safe),
      );
      return jsonRequestWithBody(ctx.request, governedInput);
    },
    async onResponse(ctx: OpenBoxCopilotRuntimeResponseHookContext): Promise<Response | void> {
      if (ctx.route?.method !== 'agent/run') return;
      return undefined;
    },
    async onError(ctx: OpenBoxCopilotRuntimeErrorHookContext): Promise<Response | void> {
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

async function governRunPrompt(
  adapter: OpenBoxCopilotKitAdapter,
  input: OpenBoxCopilotRunInputLike,
  sessionKey: string,
  subscriber: OpenBoxSubscriberLike,
): Promise<OpenBoxCopilotRunInputLike | undefined> {
  const promptGate = await adapter.governPrompt({
    payload: { messages: input.messages ?? [] },
    sessionKey,
    workflowId: input.runId,
    runId: input.runId,
    activityType: 'on_chat_model_start',
  });
  if (shouldStopForGate(promptGate, 'enforce')) {
    emitOpenBoxRunResult(subscriber, input, adapter.toOpenBoxCopilotResult(promptGate.verdict, promptGate));
    return undefined;
  }
  return withGovernedRunInput(input, promptGate.safe);
}

function normalizeSubscriber(
  observerOrNext?: unknown,
  error?: unknown,
  complete?: unknown,
): OpenBoxSubscriberLike {
  if (typeof observerOrNext === 'function') {
    return {
      next: observerOrNext as (value: unknown) => void,
      error: typeof error === 'function' ? error as (err: unknown) => void : undefined,
      complete: typeof complete === 'function' ? complete as () => void : undefined,
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
  const assistantBuffers = new Map<string, {
    start?: Record<string, any>;
    content: string;
    end?: Record<string, any>;
  }>();
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
        pending.push((async () => {
          const gate = await adapter.governAssistantOutput({
            payload: { content: buffer.content },
            sessionKey,
            workflowId: input.runId,
            runId: input.runId,
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
          const safeContent = contentFromSafePayload(gate.safe, buffer.content);
          emit(buffer.start);
          emit({ ...contentEventFromStart(buffer.start, safeContent), type: contentEventType(type) });
          emit(buffer.end);
        })().catch((error) => subscriber.error?.(error)));
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
  return (type === 'TEXT_MESSAGE_START' || type === 'TextMessageStart') &&
    String(event.role ?? 'assistant') === 'assistant';
}

function isAssistantTextContent(event: Record<string, any>): boolean {
  const type = String(event.type);
  return type === 'TEXT_MESSAGE_CONTENT' ||
    type === 'TEXT_MESSAGE_CHUNK' ||
    type === 'TextMessageContent' ||
    type === 'TextMessageChunk';
}

function isAssistantTextEnd(event: Record<string, any>): boolean {
  const type = String(event.type);
  return type === 'TEXT_MESSAGE_END' || type === 'TextMessageEnd';
}

function messageIdForEvent(event: Record<string, any>): string {
  return String(event.messageId ?? event.id ?? 'openbox-message');
}

function contentEventType(endType: string): string {
  return endType.startsWith('Text') ? 'TextMessageContent' : 'TEXT_MESSAGE_CONTENT';
}

function contentEventFromStart(
  start: Record<string, any> | undefined,
  content: string,
): Record<string, any> {
  return {
    messageId: start?.messageId ?? start?.id ?? `openbox_message_${randomUUID()}`,
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
): OpenBoxCopilotRunInputLike {
  if (isRecord(safe) && Array.isArray(safe.messages)) {
    return { ...input, messages: safe.messages as Array<Record<string, any>> };
  }
  return input;
}

function isRuntimePromptGoverned(input: OpenBoxCopilotRunInputLike): boolean {
  return isRecord(input.state) &&
    (input.state as Record<string, unknown>)[OPENBOX_RUNTIME_PROMPT_GOVERNED_KEY] === true;
}

function markRuntimePromptGoverned(input: OpenBoxCopilotRunInputLike): OpenBoxCopilotRunInputLike {
  const state = isRecord(input.state) ? input.state as Record<string, unknown> : {};
  return {
    ...input,
    state: {
      ...state,
      [OPENBOX_RUNTIME_PROMPT_GOVERNED_KEY]: true,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

export interface GovernedCopilotTool<
  TInput extends OpenBoxCopilotActionInput = OpenBoxCopilotActionInput,
  TArtifact = unknown,
> {
  execute(input: TInput, config?: unknown): Promise<OpenBoxCopilotActionResult<TArtifact>>;
  resume(
    input: TInput & OpenBoxCopilotResumeInput,
    config?: unknown,
  ): Promise<OpenBoxCopilotActionResult<TArtifact>>;
}

export function createOpenBoxCopilotKitAdapter(
  config: OpenBoxCopilotKitConfig = {},
): OpenBoxCopilotKitAdapter {
  let coreClient: OpenBoxCoreClient | undefined = config.core;
  let coreClientCacheKey: string | undefined;
  const strict = config.strict ?? true;
  const governanceMode = config.governanceMode ?? 'enforce';
  const failClosed = config.failClosed ?? true;
  const redactionMode = config.redactionMode ?? 'transformed-only';
  const haltedSessions = new Map<
    string,
    Extract<OpenBoxCopilotSessionState, { status: 'halted' }>
  >();
  const selfGovernedToolNames = new Set([
    'openbox_governed_action',
    'openbox_governed_approval_action',
    'openbox_resume_governed_action',
    ...(config.selfGovernedToolNames ?? []),
  ]);

  const adapter: OpenBoxCopilotKitAdapter = {
    isEnabled: () => config.enabled ?? (Boolean(config.core) || process.env.OPENBOX_ENABLED === 'true'),
    getCoreClient: () => {
      if (config.core) return config.core;
      const apiKey = config.apiKey ?? process.env.OPENBOX_API_KEY;
      const coreUrl = config.coreUrl ?? process.env.OPENBOX_CORE_URL;
      if (!apiKey) {
        throw new OpenBoxCopilotKitError(
          'OpenBox is enabled but the runtime API key is not configured.',
        );
      }
      if (!OPENBOX_RUNTIME_KEY_PATTERN.test(apiKey)) {
        throw new OpenBoxCopilotKitError(
          'OpenBox is enabled but the runtime API key must be an obx_live_* or obx_test_* key.',
        );
      }
      if (!coreUrl) {
        throw new OpenBoxCopilotKitError(
          'OpenBox is enabled but the Core URL is not configured.',
        );
      }
      const cacheKey = `${coreUrl}:${apiKey}`;
      if (!coreClient || coreClientCacheKey !== cacheKey) {
        coreClient = new OpenBoxCoreClient({ apiKey, apiUrl: coreUrl });
        coreClientCacheKey = cacheKey;
      }
      return coreClient;
    },
    wrapAgent: (agent) => agent,
    createLangChainMiddleware: (deps) =>
      createOpenBoxLangChainMiddleware({
        adapter,
        deps,
        workflowType: config.agentWorkflowType ?? DEFAULT_AGENT_WORKFLOW_TYPE,
        taskQueue: config.taskQueue ?? DEFAULT_TASK_QUEUE,
        selfGovernedToolNames,
        strict,
        governanceMode,
        failClosed,
      }),
    governPrompt: (input) => governPipelineGate(adapter, {
      kind: 'prompt',
      workflowType: config.agentWorkflowType ?? DEFAULT_AGENT_WORKFLOW_TYPE,
      taskQueue: config.taskQueue ?? DEFAULT_TASK_QUEUE,
      haltedSessions,
      strict,
      governanceMode,
      failClosed,
      redactionMode,
      ...input,
    }),
    governToolInput: (input) => governPipelineGate(adapter, {
      kind: 'tool_input',
      workflowType: config.agentWorkflowType ?? DEFAULT_AGENT_WORKFLOW_TYPE,
      taskQueue: config.taskQueue ?? DEFAULT_TASK_QUEUE,
      haltedSessions,
      strict,
      governanceMode,
      failClosed,
      redactionMode,
      ...input,
    }),
    governToolOutput: (input) => governPipelineGate(adapter, {
      kind: 'tool_output',
      workflowType: config.agentWorkflowType ?? DEFAULT_AGENT_WORKFLOW_TYPE,
      taskQueue: config.taskQueue ?? DEFAULT_TASK_QUEUE,
      haltedSessions,
      strict,
      governanceMode,
      failClosed,
      redactionMode,
      ...input,
    }),
    governAssistantOutput: (input) => governPipelineGate(adapter, {
      kind: 'assistant_output',
      workflowType: config.agentWorkflowType ?? DEFAULT_AGENT_WORKFLOW_TYPE,
      taskQueue: config.taskQueue ?? DEFAULT_TASK_QUEUE,
      haltedSessions,
      strict,
      governanceMode,
      failClosed,
      redactionMode,
      ...input,
    }),
    applyOpenBoxTransform: (original, verdict) => applyOpenBoxTransform(original, verdict),
    toOpenBoxCopilotResult: (verdict, safePayload) =>
      safePayloadToCopilotResult(verdict, safePayload),
    haltSession: (sessionKey, session) => {
      haltedSessions.set(sessionKey, session);
    },
    isSessionHalted: (sessionKey) => haltedSessions.get(sessionKey),
    governTool: (definition) =>
      createGovernedCopilotTool({
        adapter,
        ...definition,
      }),
    approvalRoute: createOpenBoxApprovalRoute(config),
    rendering: {
      governedToolNames: [
        'openbox_governed_action',
        'openbox_governed_approval_action',
        'openbox_resume_governed_action',
      ],
      approvalToolName: 'openboxApprovalReview',
      interactiveToolName: 'openboxInteractiveReview',
      isGovernedToolResult: (value) => {
        const parsed = parseToolResult(value);
        return typeof parsed.status === 'string' && typeof parsed.verdict === 'string';
      },
      parseToolResult,
    },
  };

  return adapter;
}

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
    definition.sessionKey ? definition.sessionKey(config) : sessionKeyFromConfig(config);

  async function execute(
    input: TInput,
    runtimeConfig?: unknown,
  ): Promise<OpenBoxCopilotActionResult<TArtifact>> {
    const normalizedInput = normalize(input);
    const key = sessionKey(runtimeConfig);
    const haltedSession = haltedSessions.get(key);
    if (haltedSession) return sessionHaltedResult(normalizedInput, haltedSession) as OpenBoxCopilotActionResult<TArtifact>;
    const ids = createWorkflowIds();

    if (!definition.adapter.isEnabled()) {
      const artifact = await definition.execute(normalizedInput);
      return executedResult(normalizedInput, ids, artifact, 'OpenBox disabled for local development.');
    }

    try {
      const session = createWorkflowSession(definition.adapter, ids, workflowType, taskQueue);
      await session.workflowStarted();
      const started = await evaluate(definition.adapter, activityEvent(
        'ActivityStarted',
        ids,
        workflowType,
        taskQueue,
        {
          activity_input: [toolInput(definition, normalizedInput)],
          spans: [toolSpan(definition, normalizedInput, 'started')],
        },
      ));

      if (started.arm === 'require_approval') {
        return approvalRequiredResult(normalizedInput, ids, started) as OpenBoxCopilotActionResult<TArtifact>;
      }
      if (!isAllowed(started.arm)) {
        await failWorkflow(definition.adapter, ids, workflowType, taskQueue, started.reason);
        const result = stoppedResult(normalizedInput, ids, started);
        if (result.status === 'halted') haltedSessions.set(key, result.session as any);
        return result as OpenBoxCopilotActionResult<TArtifact>;
      }

      const startedRedaction = applyStartedRedaction(definition, normalizedInput, started);
      const artifact = await definition.execute(startedRedaction.input);
      const provisional = resultForAllowedVerdict(
        startedRedaction.input,
        ids,
        started,
        artifact,
        'OpenBox allowed this action.',
        startedRedaction.summary,
      );
      const completed = await evaluate(definition.adapter, activityEvent(
        'ActivityCompleted',
        ids,
        workflowType,
        taskQueue,
        {
          activity_input: [toolInput(definition, startedRedaction.input)],
          activity_output: provisional,
          spans: [toolSpan(definition, startedRedaction.input, 'completed')],
        },
      ));

      if (!isAllowed(completed.arm)) {
        await failWorkflow(definition.adapter, ids, workflowType, taskQueue, completed.reason);
        const stopped = stoppedResult(startedRedaction.input, ids, completed, provisional.executed);
        if (stopped.status === 'halted') haltedSessions.set(key, stopped.session as any);
        return stopped as OpenBoxCopilotActionResult<TArtifact>;
      }

      const result = applyCompletedRedaction(definition, provisional, completed, startedRedaction.summary);
      await session.workflowCompleted();
      return result;
    } catch (error) {
      await failWorkflow(definition.adapter, ids, workflowType, taskQueue, error);
      return errorResult(normalizedInput, ids, error) as OpenBoxCopilotActionResult<TArtifact>;
    }
  }

  async function resume(
    input: TInput & OpenBoxCopilotResumeInput,
    runtimeConfig?: unknown,
  ): Promise<OpenBoxCopilotActionResult<TArtifact>> {
    const normalizedInput = normalize(input) as TInput & OpenBoxCopilotResumeInput;
    const key = sessionKey(runtimeConfig);
    const haltedSession = haltedSessions.get(key);
    if (haltedSession) return sessionHaltedResult(normalizedInput, haltedSession) as OpenBoxCopilotActionResult<TArtifact>;
    const ids = {
      workflowId: normalizedInput.workflowId,
      runId: normalizedInput.runId,
      activityId: normalizedInput.activityId,
    };

    if (!definition.adapter.isEnabled()) {
      const artifact = await definition.execute(normalizedInput);
      return executedResult(normalizedInput, ids, artifact, 'OpenBox disabled for local development.');
    }

    try {
      const polled = await pollApproval(definition.adapter, ids);
      if (!isAllowed(polled.arm)) {
        await failWorkflow(definition.adapter, ids, workflowType, taskQueue, polled.reason);
        if (normalizedInput.approved === false) return rejectedResult(normalizedInput, ids, polled) as OpenBoxCopilotActionResult<TArtifact>;
        const stopped = stoppedResult(normalizedInput, ids, polled);
        if (stopped.status === 'halted') haltedSessions.set(key, stopped.session as any);
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
      const completed = await evaluate(definition.adapter, activityEvent(
        'ActivityCompleted',
        ids,
        workflowType,
        taskQueue,
        {
          activity_input: [toolInput(definition, normalizedInput)],
          activity_output: result,
          spans: [toolSpan(definition, normalizedInput, 'completed')],
        },
      ));

      if (!isAllowed(completed.arm)) {
        await failWorkflow(definition.adapter, ids, workflowType, taskQueue, completed.reason);
        const stopped = stoppedResult(normalizedInput, ids, completed, result.executed);
        if (stopped.status === 'halted') haltedSessions.set(key, stopped.session as any);
        return stopped as OpenBoxCopilotActionResult<TArtifact>;
      }

      await completeWorkflow(definition.adapter, ids, workflowType, taskQueue);
      return applyCompletedRedaction(definition, result, completed);
    } catch (error) {
      await failWorkflow(definition.adapter, ids, workflowType, taskQueue, error);
      return errorResult(normalizedInput, ids, error) as OpenBoxCopilotActionResult<TArtifact>;
    }
  }

  return { execute, resume };
}

export function createOpenBoxApprovalRoute(config: OpenBoxCopilotKitConfig = {}) {
  return {
    async decide(
      request: OpenBoxApprovalDecisionRequest,
    ): Promise<OpenBoxApprovalDecisionResult> {
      const apiUrl = config.apiUrl ?? process.env.OPENBOX_API_URL;
      const apiKey = config.platformApiKey ?? process.env.OPENBOX_PLATFORM_API_KEY;
      const agentId = config.agentId ?? process.env.OPENBOX_AGENT_ID;
      if (!apiUrl) throw new Error('OpenBox API URL is not configured.');
      if (!apiKey) throw new Error('OpenBox platform API key is not configured.');
      if (!agentId) throw new Error('OpenBox agent ID is not configured.');
      const client = new OpenBoxClient({
        apiUrl: apiUrl.replace(/\/+$/, ''),
        apiKey,
        clientName: config.clientName ?? 'openbox-copilotkit',
      });
      const resolved = await decideApproval(
        client,
        { governanceEventId: request.governanceEventId, agentId },
        request.decision,
      );
      return { ok: true, decision: request.decision, eventId: resolved.eventId };
    },
  };
}

export function createOpenBoxReadinessCheck(config: OpenBoxCopilotKitConfig = {}) {
  return {
    async check(): Promise<{
      ok: boolean;
      mode: {
        enabled: boolean;
        strict: boolean;
        governanceMode: 'observe' | 'enforce';
        failClosed: boolean;
      };
      core: boolean;
      guardrails: boolean;
      policies: boolean;
      behaviorRules: boolean;
      approvals: boolean;
      capabilities: {
        promptGovernance: boolean;
        toolInputGovernance: boolean;
        toolOutputGovernance: boolean;
        finalOutputGovernance: boolean;
        approvals: boolean;
        guardrails: boolean;
        policies: boolean;
        behaviorRules: boolean;
      };
      errors: string[];
    }> {
      const errors: string[] = [];
      const mode = {
        enabled: config.enabled ?? process.env.OPENBOX_ENABLED !== 'false',
        strict: config.strict ?? true,
        governanceMode: config.governanceMode ?? 'enforce' as const,
        failClosed: config.failClosed ?? true,
      };
      const apiUrl = config.apiUrl ?? process.env.OPENBOX_API_URL;
      const apiKey = config.platformApiKey ?? process.env.OPENBOX_PLATFORM_API_KEY;
      const agentId = config.agentId ?? process.env.OPENBOX_AGENT_ID;
      const core = await readinessStep(errors, 'core', async () => {
        createOpenBoxCopilotKitAdapter(config).getCoreClient();
      });
      if (!apiUrl || !apiKey || !agentId) {
        const missing = [
          !apiUrl ? 'OPENBOX_API_URL' : undefined,
          !apiKey ? 'OPENBOX_PLATFORM_API_KEY' : undefined,
          !agentId ? 'OPENBOX_AGENT_ID' : undefined,
        ].filter(Boolean).join(', ');
        errors.push(`backend config missing: ${missing}`);
        return {
          ok: false,
          mode,
          core,
          guardrails: false,
          policies: false,
          behaviorRules: false,
          approvals: false,
          capabilities: {
            promptGovernance: core,
            toolInputGovernance: core,
            toolOutputGovernance: core,
            finalOutputGovernance: core,
            approvals: false,
            guardrails: false,
            policies: false,
            behaviorRules: false,
          },
          errors,
        };
      }
      const client = new OpenBoxClient({
        apiUrl: apiUrl.replace(/\/+$/, ''),
        apiKey,
        clientName: config.clientName ?? 'openbox-copilotkit',
      });
      const guardrails = await readinessStep(errors, 'guardrails', () => client.listGuardrails(agentId));
      const policies = await readinessStep(errors, 'policies', () => client.getCurrentPolicies(agentId));
      const behaviorRules = await readinessStep(errors, 'behavior rules', () => client.getCurrentBehaviorRules(agentId));
      const approvals = await readinessStep(errors, 'approvals', () => client.getPendingApprovals(agentId));
      return {
        ok: core && guardrails && policies && behaviorRules && approvals,
        mode,
        core,
        guardrails,
        policies,
        behaviorRules,
        approvals,
        capabilities: {
          promptGovernance: core,
          toolInputGovernance: core,
          toolOutputGovernance: core,
          finalOutputGovernance: core,
          approvals,
          guardrails,
          policies,
          behaviorRules,
        },
        errors,
      };
    },
  };
}

async function readinessStep(
  errors: string[],
  name: string,
  fn: () => Promise<unknown> | unknown,
): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (error) {
    errors.push(`${name}: ${errorMessage(error)}`);
    return false;
  }
}

async function governPipelineGate<T>(
  adapter: OpenBoxCopilotKitAdapter,
  input: OpenBoxCopilotGateInput<T> & {
    kind: OpenBoxCopilotGateKind;
    workflowType: string;
    taskQueue: string;
    haltedSessions: Map<string, Extract<OpenBoxCopilotSessionState, { status: 'halted' }>>;
    strict: boolean;
    governanceMode: 'observe' | 'enforce';
    failClosed: boolean;
    redactionMode: 'transformed-only';
  },
): Promise<OpenBoxSafePayload<T>> {
  const ids = {
    workflowId: input.workflowId ?? randomUUID(),
    runId: input.runId ?? randomUUID(),
    activityId: input.activityId ?? randomUUID(),
  };
  const key = input.sessionKey ?? 'default';
  const halted = input.haltedSessions.get(key);
  if (halted) {
    const verdict: WorkflowVerdict = {
      arm: 'halt',
      reason: halted.reason,
      riskScore: 0,
    };
    return {
      safe: input.payload,
      verdict,
      status: 'session_halted',
      changed: false,
      rawBlocked: true,
      reason: halted.reason,
      message: halted.reason,
      workflowId: ids.workflowId,
      runId: ids.runId,
      activityId: ids.activityId,
      session: halted,
    };
  }
  if (!adapter.isEnabled()) {
    const verdict: WorkflowVerdict = {
      arm: 'allow',
      reason: 'OpenBox disabled for local development.',
      riskScore: 0,
    };
    return safePayload(input.payload, input.payload, verdict, ids, false);
  }
  try {
    const verdict = await evaluate(adapter, gateEvent(input, ids));
    const safe = isAllowed(verdict.arm)
      ? applyOpenBoxTransform(input.payload, verdict)
      : input.payload;
    const changed = !sameJson(safe, input.payload);
    const payload = safePayload(safe, input.payload, verdict, ids, changed);
    if (payload.status === 'halted') {
      input.haltedSessions.set(key, payload.session as Extract<OpenBoxCopilotSessionState, { status: 'halted' }>);
    }
    return payload;
  } catch (error) {
    if (!input.failClosed || input.governanceMode === 'observe') {
      const verdict: WorkflowVerdict = {
        arm: 'allow',
        reason: errorMessage(error),
        riskScore: 0,
      };
      return safePayload(input.payload, input.payload, verdict, ids, false);
    }
    const verdict: WorkflowVerdict = {
      arm: 'block',
      reason: errorMessage(error),
      riskScore: 0,
    };
    return safePayload(input.payload, input.payload, verdict, ids, false);
  }
}

function gateEvent<T>(
  input: OpenBoxCopilotGateInput<T> & {
    kind: OpenBoxCopilotGateKind;
    workflowType: string;
    taskQueue: string;
  },
  ids: { workflowId: string; runId: string; activityId: string },
): GovernanceEventPayload {
  const completed = input.kind === 'tool_output' || input.kind === 'assistant_output';
  const activityType = input.activityType ?? activityTypeForGate(input.kind);
  return activityEvent(
    completed ? 'ActivityCompleted' : 'ActivityStarted',
    ids,
    input.workflowType,
    input.taskQueue,
    completed
      ? {
          activity_type: activityType,
          activity_output: input.payload,
          spans: [pipelineSpan(input.kind, activityType, input.payload)],
        }
      : {
          activity_type: activityType,
          activity_input: [input.payload],
          spans: [pipelineSpan(input.kind, activityType, input.payload)],
        },
  );
}

function activityTypeForGate(kind: OpenBoxCopilotGateKind): string {
  switch (kind) {
    case 'prompt':
      return 'UserPromptSubmit';
    case 'tool_input':
      return 'on_tool_start';
    case 'tool_output':
      return 'on_tool_end';
    case 'assistant_output':
      return 'on_llm_end';
  }
}

function pipelineSpan(kind: OpenBoxCopilotGateKind, activityType: string, payload: unknown): SpanData {
  const now = Date.now();
  return {
    span_id: randomBytes(8).toString('hex'),
    trace_id: randomBytes(16).toString('hex'),
    name: activityType,
    kind: 'internal',
    start_time: now,
    end_time: now,
    duration_ns: 0,
    stage: kind === 'prompt' || kind === 'tool_input' ? 'started' : 'completed',
    attributes: {
      'openbox.copilotkit.gate': kind,
      'openbox.activity_type': activityType,
    },
    data: payload,
  } as SpanData;
}

function applyOpenBoxTransform<T>(original: T, verdict: WorkflowVerdict): T {
  if (!hasGuardrailRedaction(verdict.guardrailsResult)) return original;
  const inputType = verdict.guardrailsResult?.inputType;
  if (inputType === 'activity_output') {
    return applyOutputRedaction(cloneValue(original), verdict.guardrailsResult);
  }
  return applyInputRedaction(cloneValue(original), verdict.guardrailsResult);
}

function safePayload<T>(
  safe: T,
  original: T,
  verdict: WorkflowVerdict,
  ids: { workflowId: string; runId: string; activityId: string },
  changed: boolean,
): OpenBoxSafePayload<T> {
  const status = statusForVerdict(verdict);
  const haltedAt = new Date().toISOString();
  const session = status === 'halted'
    ? {
        status: 'halted' as const,
        reason: verdict.reason || 'OpenBox halted this CopilotKit session.',
        haltedAt,
        ...ids,
      }
    : { status: 'active' as const };
  return {
    safe,
    verdict,
    status,
    changed,
    rawBlocked: !isAllowed(verdict.arm),
    reason: verdict.reason || defaultReasonForVerdict(verdict.arm),
    message: verdict.reason || defaultReasonForVerdict(verdict.arm),
    redactionSummary: hasGuardrailRedaction(verdict.guardrailsResult)
      ? summarizeGuardrailRedaction(verdict.guardrailsResult)
      : undefined,
    workflowId: ids.workflowId,
    runId: ids.runId,
    activityId: ids.activityId,
    session,
  };
}

function safePayloadToCopilotResult<T>(
  verdict: WorkflowVerdict,
  safePayload: OpenBoxSafePayload<T>,
): OpenBoxCopilotActionResult<T> {
  return {
    schemaVersion: OPENBOX_COPILOTKIT_RESULT_SCHEMA_VERSION,
    status: safePayload.status,
    verdict: verdict.arm,
    executed: false,
    action: 'copilotkit_runtime_gate',
    request: 'CopilotKit runtime governance gate',
    destination: null,
    amountUsd: null,
    fields: null,
    audience: null,
    sensitivity: null,
    reason: safePayload.reason,
    message: safePayload.message,
    artifact: safePayload.rawBlocked ? undefined : safePayload.safe,
    workflowId: safePayload.workflowId,
    runId: safePayload.runId,
    activityId: safePayload.activityId,
    session: safePayload.session,
    ...verdictMetadata(verdict, safePayload.redactionSummary),
  };
}

function createOpenBoxLangChainMiddleware({
  adapter,
  deps,
  workflowType,
  taskQueue,
  selfGovernedToolNames,
  strict,
  governanceMode,
  failClosed,
}: {
  adapter: OpenBoxCopilotKitAdapter;
  deps: OpenBoxCopilotLangChainMiddlewareDeps;
  workflowType: string;
  taskQueue: string;
  selfGovernedToolNames: Set<string>;
  strict: boolean;
  governanceMode: 'observe' | 'enforce';
  failClosed: boolean;
}) {
  return deps.createMiddleware({
    name: 'openbox_copilotkit',
    stateSchema: undefined,
    beforeAgent: async () => {
      if (!adapter.isEnabled()) return;
      const ids = { openboxWorkflowId: randomUUID(), openboxRunId: randomUUID() };
      const session = createWorkflowSession(
        adapter,
        { workflowId: ids.openboxWorkflowId, runId: ids.openboxRunId },
        workflowType,
        taskQueue,
      );
      await swallow(() => session.workflowStarted());
      await swallow(() => (session as any).onChainStart({
        input: [{ runtime: 'copilotkit', framework: 'langchain' }],
      }));
      return ids;
    },
    wrapModelCall: async (request: any, handler: (request: any) => Promise<unknown>) => {
      if (!adapter.isEnabled()) return handler(request);
      const session = agentSessionForState(adapter, request.state, workflowType, taskQueue);
      const key = sessionKeyFromConfig(request);
      const runtimePromptGoverned = isRecord(request.state) &&
        request.state[OPENBOX_RUNTIME_PROMPT_GOVERNED_KEY] === true;
      if (!runtimePromptGoverned) {
        const promptGate = await adapter.governPrompt({
          payload: modelInput(request),
          sessionKey: key,
          workflowId: workflowIdFromState(request.state),
          runId: runIdFromState(request.state),
          activityType: 'on_chat_model_start',
        });
        if (shouldStopForGate(promptGate, governanceMode)) {
          return new deps.AIMessage({
            content: JSON.stringify(adapter.toOpenBoxCopilotResult(promptGate.verdict, promptGate)),
          });
        }
        request = withGovernedModelInput(request, promptGate.safe);
      }
      const governedRoute = deps.routeLatestUserPrompt?.(request.messages);
      if (governedRoute) {
        return new deps.AIMessage({
          content: '',
          tool_calls: [{
            id: `openbox_preflight_${randomUUID().replace(/-/g, '')}`,
            name: governedRoute.toolName,
            args: governedRoute.args,
          }],
        });
      }
      try {
        const response = await handler(request);
        if (runtimePromptGoverned) return response;
        const responseGate = await adapter.governAssistantOutput({
          payload: toPlain(response),
          sessionKey: key,
          workflowId: workflowIdFromState(request.state),
          runId: runIdFromState(request.state),
          activityType: 'on_llm_end',
        });
        if (shouldStopForGate(responseGate, governanceMode)) {
          return new deps.AIMessage({
            content: JSON.stringify(adapter.toOpenBoxCopilotResult(responseGate.verdict, responseGate)),
          });
        }
        return withGovernedAssistantOutput(response, responseGate.safe);
      } catch (error) {
        await swallow(() => (session as any).onLlmError({ output: errorOutput(error) }));
        await swallow(() => session.workflowFailed(error));
        if (!failClosed) throw error;
        throw error;
      }
    },
    wrapToolCall: async (request: any, handler: (request: any) => Promise<unknown>) => {
      if (!adapter.isEnabled()) return handler(request);
      if (selfGovernedToolNames.has(String(request.toolCall?.name))) return handler(request);
      const session = agentSessionForState(adapter, request.state, workflowType, taskQueue);
      const key = sessionKeyFromConfig(request);
      const inputGate = await adapter.governToolInput({
        payload: toolCallInput(request),
        sessionKey: key,
        workflowId: workflowIdFromState(request.state),
        runId: runIdFromState(request.state),
        activityType: 'on_tool_start',
      });
      if (shouldStopForGate(inputGate, governanceMode)) {
        return JSON.stringify(adapter.toOpenBoxCopilotResult(inputGate.verdict, inputGate));
      }
      request = withGovernedToolInput(request, inputGate.safe);
      try {
        const response = await handler(request);
        const outputGate = await adapter.governToolOutput({
          payload: toPlain(response),
          sessionKey: key,
          workflowId: workflowIdFromState(request.state),
          runId: runIdFromState(request.state),
          activityType: 'on_tool_end',
        });
        if (shouldStopForGate(outputGate, governanceMode)) {
          return JSON.stringify(adapter.toOpenBoxCopilotResult(outputGate.verdict, outputGate));
        }
        return outputGate.safe;
      } catch (error) {
        await swallow(() => (session as any).onToolError({
          output: { toolName: request.toolCall?.name, ...errorOutput(error) },
        }));
        await swallow(() => session.workflowFailed(error));
        throw error;
      }
    },
    afterAgent: async (state: any) => {
      if (!adapter.isEnabled()) return;
      if (isRecord(state) && state[OPENBOX_RUNTIME_PROMPT_GOVERNED_KEY] === true) {
        const session = agentSessionForState(adapter, state, workflowType, taskQueue);
        await swallow(() => session.workflowCompleted());
        return;
      }
      const session = agentSessionForState(adapter, state, workflowType, taskQueue);
      const finishGate = await adapter.governAssistantOutput({
        payload: {
          messages: summarizeMessages(state?.messages),
          structuredResponse: toPlain(state?.structuredResponse),
        },
        sessionKey: sessionKeyFromConfig(state),
        workflowId: workflowIdFromState(state),
        runId: runIdFromState(state),
        activityType: 'on_agent_finish',
      });
      if (shouldStopForGate(finishGate, governanceMode) && strict) {
        await swallow(() => session.workflowFailed(finishGate.reason));
        return;
      }
      await swallow(() => session.workflowCompleted());
    },
  });
}

function createWorkflowIds() {
  return {
    workflowId: randomUUID(),
    runId: randomUUID(),
    activityId: randomUUID(),
  };
}

function createWorkflowSession(
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

function agentSessionForState(
  adapter: OpenBoxCopilotKitAdapter,
  state: Record<string, unknown> | undefined,
  workflowType: string,
  taskQueue: string,
): BaseGovernedSession {
  return createWorkflowSession(adapter, {
    workflowId: typeof state?.openboxWorkflowId === 'string' ? state.openboxWorkflowId : randomUUID(),
    runId: typeof state?.openboxRunId === 'string' ? state.openboxRunId : randomUUID(),
  }, workflowType, taskQueue);
}

async function evaluate(
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

async function pollApproval(
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
      trustTier: typeof extra.trust_tier === 'number' ? extra.trust_tier : undefined,
      guardrailsResult: mapGuardrailsResult(extra.guardrails_result),
    };
    if (last && last.arm !== 'require_approval') return last;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return last ?? { arm: 'require_approval', reason: 'OpenBox approval is still pending.', riskScore: 0 };
}

async function completeWorkflow(
  adapter: OpenBoxCopilotKitAdapter,
  ids: { workflowId: string; runId: string },
  workflowType: string,
  taskQueue: string,
) {
  await createWorkflowSession(adapter, ids, workflowType, taskQueue).workflowCompleted();
}

async function failWorkflow(
  adapter: OpenBoxCopilotKitAdapter,
  ids: { workflowId: string; runId: string },
  workflowType: string,
  taskQueue: string,
  reason: unknown,
) {
  await swallow(() => createWorkflowSession(adapter, ids, workflowType, taskQueue)
    .workflowFailed(typeof reason === 'string' ? new Error(reason) : reason));
}

function activityEvent(
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
    activity_type: eventType === 'ActivityStarted' ? 'on_tool_start' : 'on_tool_end',
    ...extra,
  };
}

function toolInput<TInput extends OpenBoxCopilotActionInput>(
  definition: GovernedCopilotToolDefinition<TInput, any>,
  input: TInput,
) {
  return {
    id: undefined,
    name: definition.toolName,
    args: input,
    description: definition.description,
  };
}

function toolSpan<TInput extends OpenBoxCopilotActionInput>(
  definition: GovernedCopilotToolDefinition<TInput, any>,
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

function baseResult<TInput extends OpenBoxCopilotActionInput>(
  input: TInput,
  ids?: { workflowId: string; runId: string; activityId: string },
) {
  const passthrough = Object.fromEntries(
    Object.entries(input).filter(([key]) => !new Set([
      'action',
      'request',
      'destination',
      'amountUsd',
      'fields',
      'audience',
      'sensitivity',
      'workflowId',
      'runId',
      'activityId',
      'approvalId',
      'governanceEventId',
      'approved',
    ]).has(key)),
  );
  return {
    ...passthrough,
    schemaVersion: OPENBOX_COPILOTKIT_RESULT_SCHEMA_VERSION,
    action: input.action,
    request: input.request,
    destination: typeof input.destination === 'string' ? input.destination : null,
    amountUsd: typeof input.amountUsd === 'number' ? input.amountUsd : null,
    fields: Array.isArray(input.fields) ? input.fields : null,
    audience: typeof input.audience === 'string' ? input.audience : null,
    sensitivity: typeof input.sensitivity === 'string' ? input.sensitivity : null,
    workflowId: ids?.workflowId,
    runId: ids?.runId,
    activityId: ids?.activityId,
  };
}

function approvalRequiredResult<TInput extends OpenBoxCopilotActionInput>(
  input: TInput,
  ids: { workflowId: string; runId: string; activityId: string },
  verdict: WorkflowVerdict,
): OpenBoxCopilotActionResult {
  return {
    ...baseResult(input, ids),
    status: 'approval_required',
    verdict: 'require_approval',
    executed: false,
    approvalId: verdict.approvalId,
    governanceEventId: verdict.governanceEventId,
    expiresAt: verdict.approvalExpiresAt,
    reason: verdict.reason || 'OpenBox requires human approval.',
    message: 'OpenBox requires human approval before this action can continue.',
    ...verdictMetadata(verdict),
  };
}

function stoppedResult<TInput extends OpenBoxCopilotActionInput>(
  input: TInput,
  ids: { workflowId: string; runId: string; activityId: string },
  verdict: WorkflowVerdict,
  executed = false,
): OpenBoxCopilotActionResult {
  const status = verdict.arm === 'halt' ? 'halted' : 'blocked';
  const haltedAt = new Date().toISOString();
  return {
    ...baseResult(input, ids),
    status,
    verdict: verdict.arm,
    executed,
    reason: verdict.reason || 'OpenBox stopped this action.',
    message: verdict.reason || 'OpenBox stopped this action.',
    session: status === 'halted'
      ? { status: 'halted', reason: verdict.reason || 'OpenBox halted this conversation.', haltedAt, ...ids }
      : { status: 'active' },
    ...verdictMetadata(verdict),
  };
}

function sessionHaltedResult<TInput extends OpenBoxCopilotActionInput>(
  input: TInput,
  session: Extract<OpenBoxCopilotSessionState, { status: 'halted' }>,
): OpenBoxCopilotActionResult {
  return {
    ...baseResult(input, {
      workflowId: session.workflowId ?? randomUUID(),
      runId: session.runId ?? randomUUID(),
      activityId: session.activityId ?? randomUUID(),
    }),
    status: 'session_halted',
    verdict: 'halt',
    executed: false,
    reason: session.reason,
    message: session.reason,
    session,
  };
}

function rejectedResult<TInput extends OpenBoxCopilotActionInput>(
  input: TInput,
  ids: { workflowId: string; runId: string; activityId: string },
  verdict: WorkflowVerdict,
): OpenBoxCopilotActionResult {
  return {
    ...baseResult(input, ids),
    status: 'rejected',
    verdict: 'block',
    executed: false,
    reason: verdict.reason || 'OpenBox approval was rejected.',
    message: verdict.reason || 'OpenBox approval was rejected.',
    ...verdictMetadata(verdict),
  };
}

function executedResult<TInput extends OpenBoxCopilotActionInput, TArtifact>(
  input: TInput,
  ids: { workflowId: string; runId: string; activityId: string },
  artifact: TArtifact,
  reason: string,
  verdict?: WorkflowVerdict,
  redactionSummary?: string,
): OpenBoxCopilotActionResult<TArtifact> {
  return {
    ...baseResult(input, ids),
    status: 'executed',
    verdict: 'allow',
    executed: true,
    reason,
    message: `Governed action '${input.action}' executed.`,
    artifact,
    session: { status: 'active' },
    ...verdictMetadata(verdict, redactionSummary),
  };
}

function resultForAllowedVerdict<TInput extends OpenBoxCopilotActionInput, TArtifact>(
  input: TInput,
  ids: { workflowId: string; runId: string; activityId: string },
  verdict: WorkflowVerdict,
  artifact: TArtifact,
  reason: string,
  redactionSummary?: string,
): OpenBoxCopilotActionResult<TArtifact> {
  const result = executedResult(input, ids, artifact, reason, verdict, redactionSummary);
  if (verdict.arm !== 'constrain') return result;
  return {
    ...result,
    status: 'constrained',
    verdict: 'constrain',
    reason: verdict.reason || 'OpenBox constrained this output.',
    message: 'OpenBox allowed the action with constrained output.',
  };
}

function errorResult<TInput extends OpenBoxCopilotActionInput>(
  input: TInput,
  ids: { workflowId: string; runId: string; activityId: string },
  error: unknown,
): OpenBoxCopilotActionResult {
  return {
    ...baseResult(input, ids),
    status: 'error',
    verdict: 'block',
    executed: false,
    reason: errorMessage(error),
    message: 'OpenBox governance failed closed before executing this action.',
    session: { status: 'active' },
  };
}

function applyStartedRedaction<TInput extends OpenBoxCopilotActionInput>(
  definition: GovernedCopilotToolDefinition<TInput, any>,
  input: TInput,
  verdict: WorkflowVerdict,
): { input: TInput; summary?: string } {
  if (!hasGuardrailRedaction(verdict.guardrailsResult)) return { input };
  const redactedTools = applyInputRedaction(
    cloneValue([toolInput(definition, input)]),
    verdict.guardrailsResult,
  ) as Array<{ args?: Partial<TInput> }>;
  const redactedArgs = redactedTools?.[0]?.args;
  return {
    input: redactedArgs && typeof redactedArgs === 'object'
      ? ({ ...input, ...redactedArgs, action: input.action } as TInput)
      : input,
    summary: summarizeGuardrailRedaction(
      verdict.guardrailsResult,
      'Input redacted by OpenBox guardrails.',
    ),
  };
}

function applyCompletedRedaction<TInput extends OpenBoxCopilotActionInput, TArtifact>(
  definition: GovernedCopilotToolDefinition<TInput, TArtifact>,
  result: OpenBoxCopilotActionResult<TArtifact>,
  verdict: WorkflowVerdict,
  existingSummary?: string,
): OpenBoxCopilotActionResult<TArtifact> {
  const coreRedacted = hasGuardrailRedaction(verdict.guardrailsResult);
  const redactedResult = coreRedacted
    ? (applyOutputRedaction(cloneValue(result), verdict.guardrailsResult) as OpenBoxCopilotActionResult<TArtifact>)
    : result;
  const visibleRedaction = definition.isArtifactRedacted?.(redactedResult.artifact) ?? false;
  const finalResult =
    visibleRedaction && redactedResult.artifact && definition.markArtifactRedacted
      ? { ...redactedResult, artifact: definition.markArtifactRedacted(redactedResult.artifact) }
      : redactedResult;
  const summary = [
    existingSummary,
    coreRedacted && visibleRedaction
      ? summarizeGuardrailRedaction(verdict.guardrailsResult, 'Output redacted by OpenBox guardrails.')
      : undefined,
  ].filter(Boolean).join(' ');

  if (verdict.arm === 'constrain' || visibleRedaction) {
    return {
      ...finalResult,
      status: 'constrained',
      verdict: 'constrain',
      reason: verdict.reason || 'OpenBox allowed the action with constrained output for sensitive fields.',
      message: 'OpenBox allowed the action with constrained output.',
      ...mergedVerdictMetadata(finalResult, verdict, summary || undefined),
    };
  }
  return {
    ...finalResult,
    ...mergedVerdictMetadata(finalResult, verdict, summary || undefined),
  };
}

function verdictMetadata(verdict?: WorkflowVerdict, redactionSummary?: string) {
  return {
    riskScore: verdict?.riskScore,
    trustTier: verdict?.trustTier,
    guardrailsResult: verdict?.guardrailsResult,
    redactionSummary,
  };
}

function mergedVerdictMetadata(
  result: OpenBoxCopilotActionResult,
  verdict: WorkflowVerdict,
  redactionSummary?: string,
) {
  return {
    riskScore: verdict.riskScore ?? result.riskScore,
    trustTier: verdict.trustTier ?? result.trustTier,
    guardrailsResult: verdict.guardrailsResult ?? result.guardrailsResult,
    redactionSummary: redactionSummary || result.redactionSummary,
  };
}

function mapGuardrailsResult(value: unknown): WorkflowVerdict['guardrailsResult'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as {
    inputType?: string;
    input_type?: string;
    redactedInput?: unknown;
    redacted_input?: unknown;
    validationPassed?: boolean;
    validation_passed?: boolean;
    reasons?: Array<{ type?: unknown; field?: unknown; reason?: unknown }>;
    fieldResults?: Array<{ field?: unknown; status?: unknown; reason?: unknown }>;
    results?: Array<{
      results?: Array<{ field?: unknown; status?: unknown; reason?: unknown }>;
    }>;
  };
  const inputType = raw.inputType ?? raw.input_type;
  return {
    inputType: inputType === 'activity_output' ? 'activity_output' : 'activity_input',
    redactedInput: raw.redactedInput ?? raw.redacted_input,
    validationPassed: raw.validationPassed ?? raw.validation_passed ?? true,
    reasons: (raw.reasons ?? []).map((reason) => ({
      type: String(reason.type ?? ''),
      field: typeof reason.field === 'string' ? reason.field : undefined,
      reason: String(reason.reason ?? ''),
    })),
    fieldResults: [
      ...(raw.fieldResults ?? []),
      ...(raw.results ?? []).flatMap((group) => group.results ?? []),
    ].map((field) => ({
      field: String(field.field ?? ''),
      status: normalizeGuardrailStatus(field.status),
      reason: typeof field.reason === 'string' ? field.reason : undefined,
    })),
  };
}

function normalizeGuardrailStatus(
  value: unknown,
): 'allowed' | 'blocked' | 'redacted' | 'skipped' {
  if (value === 'blocked' || value === 'block') return 'blocked';
  if (value === 'redacted' || value === 'transformed') return 'redacted';
  if (value === 'allowed' || value === 'allow') return 'allowed';
  return 'skipped';
}

function normalizeArm(value: unknown): WorkflowVerdict['arm'] {
  if (
    value === 'allow' ||
    value === 'constrain' ||
    value === 'require_approval' ||
    value === 'block' ||
    value === 'halt'
  ) {
    return value;
  }
  if (value === 'continue') return 'allow';
  if (value === 'stop') return 'block';
  return 'block';
}

function isAllowed(arm: WorkflowVerdict['arm']): boolean {
  return arm === 'allow' || arm === 'constrain';
}

function statusForVerdict(verdict: WorkflowVerdict): OpenBoxCopilotVerdictStatus {
  if (verdict.arm === 'allow') return 'executed';
  if (verdict.arm === 'constrain') return 'constrained';
  if (verdict.arm === 'require_approval') return 'approval_required';
  if (verdict.arm === 'halt') return 'halted';
  return 'blocked';
}

function defaultReasonForVerdict(arm: WorkflowVerdict['arm']): string {
  if (arm === 'allow') return 'OpenBox allowed this CopilotKit runtime event.';
  if (arm === 'constrain') return 'OpenBox constrained this CopilotKit runtime event.';
  if (arm === 'require_approval') return 'OpenBox requires human approval.';
  if (arm === 'halt') return 'OpenBox halted this CopilotKit session.';
  return 'OpenBox blocked this CopilotKit runtime event.';
}

function shouldStopForGate(
  gate: OpenBoxSafePayload,
  governanceMode: 'observe' | 'enforce',
): boolean {
  return governanceMode === 'enforce' && gate.rawBlocked;
}

async function enforce(verdict: WorkflowVerdict, fallbackMessage: string): Promise<void> {
  if (isAllowed(verdict.arm)) return;
  throw new OpenBoxCopilotKitError(verdict.reason || fallbackMessage, verdict);
}

function modelInput(request: { messages?: unknown[]; systemPrompt?: string; tools?: unknown[] }) {
  return {
    systemPrompt: request.systemPrompt,
    messages: summarizeMessages(request.messages),
    tools: Array.isArray(request.tools) ? request.tools.map((tool) => {
      const value = objectRecord(tool);
      return { name: value.name, description: value.description };
    }) : [],
  };
}

function toolCallInput(request: {
  toolCall?: { id?: string; name?: string; args?: unknown };
  tool?: { description?: string };
}) {
  return {
    id: request.toolCall?.id,
    name: request.toolCall?.name,
    args: toPlain(request.toolCall?.args),
    description: request.tool?.description,
  };
}

function withGovernedModelInput(request: any, safe: unknown): any {
  const safeRecord = objectRecord(safe);
  if (Array.isArray(safeRecord.messages)) {
    return {
      ...request,
      messages: mergeMessageContent(request.messages, safeRecord.messages),
    };
  }
  return request;
}

function mergeMessageContent(originalMessages: unknown, safeMessages: unknown[]): unknown {
  if (!Array.isArray(originalMessages)) return originalMessages;
  return originalMessages.map((message, index) => {
    const safe = objectRecord(safeMessages[index]);
    if (!('content' in safe)) return message;
    const original = objectRecord(message);
    if (typeof original.lc_kwargs === 'object' && original.lc_kwargs !== null) {
      return {
        ...original,
        content: safe.content,
        lc_kwargs: {
          ...(original.lc_kwargs as Record<string, unknown>),
          content: safe.content,
        },
      };
    }
    return {
      ...original,
      content: safe.content,
    };
  });
}

function withGovernedToolInput(request: any, safe: unknown): any {
  const safeRecord = objectRecord(safe);
  const args = safeRecord.args ?? objectRecord(safeRecord.toolCall).args;
  if (args === undefined) return request;
  return {
    ...request,
    toolCall: {
      ...request.toolCall,
      args,
    },
  };
}

function withGovernedAssistantOutput(response: unknown, safe: unknown): unknown {
  if (response === safe) return response;
  if (!response || typeof response !== 'object') return safe;
  const safeRecord = objectRecord(safe);
  if (Object.keys(safeRecord).length === 0) return response;
  return {
    ...(response as Record<string, unknown>),
    ...safeRecord,
  };
}

export function parseToolResult(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return objectRecord(parsed);
    } catch {
      return {};
    }
  }
  return objectRecord(value);
}

function summarizeMessages(messages: unknown): unknown[] {
  if (!Array.isArray(messages)) return [];
  return messages.map((message) => {
    const value = objectRecord(message);
    const type =
      typeof value.getType === 'function'
        ? value.getType()
        : value._getType && typeof value._getType === 'function'
          ? value._getType()
          : value.type;
    return {
      type,
      name: value.name,
      id: value.id,
      content: toPlain(value.content),
      toolCalls: toPlain(value.tool_calls ?? value.toolCalls),
    };
  });
}

function toPlain(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return truncate(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return '[Function]';
  if (depth > 4) return '[MaxDepth]';
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => toPlain(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !key.startsWith('_'))
        .slice(0, 50)
        .map(([key, item]) => [key, toPlain(item, depth + 1)]),
    );
  }
  return String(value);
}

function objectRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {};
}

function errorOutput(error: unknown): Record<string, unknown> {
  return error instanceof Error
    ? { errorName: error.name, message: error.message }
    : { message: String(error) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function truncate(value: string, maxLength = 4_000): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...[truncated]` : value;
}

function sessionKeyFromConfig(config: unknown): string {
  const value = objectRecord(config);
  const configurable = objectRecord(value.configurable);
  return String(configurable.thread_id ?? configurable.threadId ?? value.thread_id ?? 'default');
}

function workflowIdFromState(state: unknown): string | undefined {
  const value = objectRecord(state);
  return typeof value.openboxWorkflowId === 'string' ? value.openboxWorkflowId : undefined;
}

function runIdFromState(state: unknown): string | undefined {
  const value = objectRecord(state);
  return typeof value.openboxRunId === 'string' ? value.openboxRunId : undefined;
}

function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

async function swallow(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    // Preserve the original caller error/result. Telemetry failure is best effort.
  }
}
