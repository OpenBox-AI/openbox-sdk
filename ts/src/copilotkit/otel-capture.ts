// Genuine OpenTelemetry capture of real sub-operation HTTP/DB/file/function
// exchanges performed inside a governed tool's execution.
//
// The CopilotKit runtime/pipeline only sees AG-UI deltas, so it can never carry
// the real provider request/response (headers like cf-ray/x-request-id, the raw
// response JSON, full usage) or the tool's real sub-operations. Those only exist
// at the HTTP/DB/file client. This module captures them into an
// AsyncLocalStorage scope so the governed tool can attach them — as canonical
// `hook_trigger` span evaluations — to its completed activity.
//
// Canonical alignment (openbox-langgraph-sdk-python): sub-operations are
// captured automatically and submitted as separate, parent-correlated span
// evaluations; the LLM call itself is NEVER spanned (its model/usage ride on the
// activity event, not a span). So LLM-pattern URLs here are captured
// telemetry-only and produce no span; every other HTTP/DB/file/function
// sub-operation produces a started+completed span pair.
//
// Correlation: the capturing instrumentation runs inside the same async call
// stack as the governed tool's `execute()`, so an AsyncLocalStorage store keyed
// to that call collects the exchanges and spans; the tool then reads them.

import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes } from 'node:crypto';
import { SpanKind, trace, type Span } from '@opentelemetry/api';
import type { SpanData } from '../core-client/index.js';
import { buildSpan, type SpanInput, type SpanType } from '../governance/spans.js';

export interface CapturedLLMExchange {
  method: string;
  url: string;
  requestBody?: unknown;
  requestHeaders: Record<string, string>;
  responseBody?: unknown;
  responseHeaders: Record<string, string>;
  httpStatusCode: number;
  startTimeMs: number;
  endTimeMs: number;
}

interface SubOpCaptureStore {
  /**
   * LLM provider exchanges captured verbatim. The governed tool turns these into
   * llm_completion span pairs (via capturedLlmCompletionSpans), matching canonical
   * where the provider POST is instrumented as an http_request span.
   */
  exchanges: CapturedLLMExchange[];
  /** Auto-captured sub-operation spans (http/db/file/function), as paired SpanData. */
  spans: SpanData[];
  /** Parent activity id used to derive parent_span_id for captured spans. */
  activityId?: string;
  /** URL prefixes to skip entirely (e.g. the OpenBox Core API itself). */
  ignoredUrlPrefixes: string[];
}

const captureStore = new AsyncLocalStorage<SubOpCaptureStore>();
const tracer = trace.getTracer('openbox-copilotkit-subops');

// Captured http span headers are redacted by buildSpan's headerMapOrNull
// (authorization/cookie/x-api-key/*token* → '<redacted>'), so no extra
// header sanitization is applied here.
const MAX_HTTP_BODY = 8192;

function defaultIgnoredUrlPrefixes(): string[] {
  // Always ignore the OpenBox Core/Backend URLs so the governance POST itself is
  // never re-instrumented (which would recurse and double-count).
  return [process.env.OPENBOX_CORE_URL, process.env.OPENBOX_API_URL]
    .map((value) => value?.trim().replace(/\/+$/, ''))
    .filter((value): value is string => Boolean(value));
}

/**
 * Run `fn` inside a capture scope so the instrumented fetch/fs/db/function can
 * record into it. Back-compat name; now also collects sub-operation spans.
 */
export function runWithLLMCapture<T>(fn: () => Promise<T>): Promise<T> {
  return captureStore.run(
    {
      exchanges: [],
      spans: [],
      ignoredUrlPrefixes: defaultIgnoredUrlPrefixes(),
    },
    fn,
  );
}

/**
 * Run `fn` inside a capture scope bound to a governed activity. Captured
 * sub-operation spans derive their `parent_span_id` from `activityId` so the
 * platform attaches them to the right activity.
 */
export function runWithSubOpCapture<T>(
  opts: { activityId?: string; ignoredUrlPrefixes?: string[] },
  fn: () => Promise<T>,
): Promise<T> {
  return captureStore.run(
    {
      exchanges: [],
      spans: [],
      activityId: opts.activityId,
      ignoredUrlPrefixes:
        opts.ignoredUrlPrefixes ?? defaultIgnoredUrlPrefixes(),
    },
    fn,
  );
}

/** Most recent LLM exchange captured in the current async scope, if any. */
export function latestCapturedLLMExchange(): CapturedLLMExchange | undefined {
  const store = captureStore.getStore();
  if (!store || store.exchanges.length === 0) return undefined;
  return store.exchanges[store.exchanges.length - 1];
}

export function capturedLLMExchanges(): CapturedLLMExchange[] {
  return captureStore.getStore()?.exchanges ?? [];
}

/** Auto-captured sub-operation spans (http/db/file/function) in the scope. */
export function capturedSubOpSpans(): SpanData[] {
  return captureStore.getStore()?.spans ?? [];
}

/** True when an active capture scope exists (instrumentation should record). */
export function isCapturing(): boolean {
  return captureStore.getStore() !== undefined;
}

function parentSpanIdForActivity(activityId: string): string {
  return createHash('sha256').update(activityId).digest('hex').slice(0, 16);
}

/**
 * Build a started+completed SpanData pair from a captured sub-operation and push
 * it into the active capture scope. Both stages share one span_id/trace_id and,
 * when the scope is activity-bound, a parent_span_id derived from the activity.
 * Real wall-clock start/end timestamps are used (more precise than the
 * duration-only back-dating the reference falls back to).
 */
function recordOpSpanPair(
  type: SpanType,
  base: SpanInput,
  completed: SpanInput,
  timing: { startMs: number; endMs: number; error?: unknown },
): void {
  const store = captureStore.getStore();
  if (!store) return;
  const spanId = randomBytes(8).toString('hex');
  const traceId = randomBytes(16).toString('hex');
  const parentSpanId = store.activityId
    ? parentSpanIdForActivity(store.activityId)
    : null;
  const startNs = Math.trunc(timing.startMs) * 1_000_000;
  const endNs = Math.trunc(timing.endMs) * 1_000_000;
  const durationNs = Math.max(1, endNs - startNs);

  const stamp = (
    span: Record<string, unknown>,
    stage: 'started' | 'completed',
  ): SpanData =>
    ({
      ...span,
      span_id: spanId,
      trace_id: traceId,
      parent_span_id: parentSpanId,
      start_time: startNs,
      end_time: stage === 'completed' ? endNs : null,
      duration_ns: stage === 'completed' ? durationNs : null,
      ...(store.activityId ? { activity_id: store.activityId } : {}),
    }) as unknown as SpanData;

  store.spans.push(
    stamp(buildSpan('copilotkit', type, { ...base, stage: 'started' }), 'started'),
    stamp(
      buildSpan('copilotkit', type, {
        ...base,
        ...completed,
        stage: 'completed',
        ...(timing.error !== undefined
          ? { error: errorString(timing.error) }
          : {}),
      } as SpanInput),
      'completed',
    ),
  );
}

function errorString(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return typeof error === 'string' ? error : String(error);
}

function truncateBody(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.length > MAX_HTTP_BODY
    ? value.slice(0, MAX_HTTP_BODY) + '...[truncated]'
    : value;
}

// ───────────────────────────────────────────────────────────────────────────
// Public record helpers for non-fetch instrumentation (fs / db / function).
// ───────────────────────────────────────────────────────────────────────────

/** Record a captured file operation as a file_operation span pair. */
export function recordFileOperation(opts: {
  filePath: string;
  operation: 'read' | 'open' | 'write' | 'delete';
  startMs: number;
  endMs: number;
  error?: unknown;
}): void {
  const type: SpanType =
    opts.operation === 'read'
      ? 'file_read'
      : opts.operation === 'write'
        ? 'file_write'
        : opts.operation === 'delete'
          ? 'file_delete'
          : 'file_open';
  recordOpSpanPair(type, { file_path: opts.filePath }, {}, opts);
}

/** Record a captured database query as a db_query span pair. */
export function recordDatabaseQuery(opts: {
  statement: string;
  operation?: string;
  system?: string;
  startMs: number;
  endMs: number;
  error?: unknown;
}): void {
  recordOpSpanPair(
    'db',
    {
      db_statement: opts.statement.slice(0, 2000),
      db_operation: opts.operation,
      db_system: opts.system,
    },
    {},
    opts,
  );
}

function serializeArg(value: unknown, max = 2000): unknown {
  if (value === undefined) return undefined;
  let text: string;
  try {
    text =
      typeof value === 'string'
        ? value
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
  } catch {
    return '<unserializable>';
  }
  return text.length > max ? text.slice(0, max) + '...[truncated]' : text;
}

/**
 * Record a captured function call as a function_call span pair. Built directly
 * (not via buildSpan) so it carries the canonical function_call shape — name,
 * function, module, args, result — rather than a shell/command shape.
 */
export function recordFunctionCall(opts: {
  name: string;
  module?: string;
  args?: unknown;
  result?: unknown;
  startMs: number;
  endMs: number;
  error?: unknown;
}): void {
  const store = captureStore.getStore();
  if (!store) return;
  const spanId = randomBytes(8).toString('hex');
  const traceId = randomBytes(16).toString('hex');
  const parentSpanId = store.activityId
    ? parentSpanIdForActivity(store.activityId)
    : null;
  const startNs = Math.trunc(opts.startMs) * 1_000_000;
  const endNs = Math.trunc(opts.endMs) * 1_000_000;
  const durationNs = Math.max(1, endNs - startNs);
  const description = opts.error !== undefined ? errorString(opts.error) : null;
  const make = (stage: 'started' | 'completed'): SpanData =>
    ({
      span_id: spanId,
      trace_id: traceId,
      parent_span_id: parentSpanId,
      name: opts.name,
      kind: 'INTERNAL',
      span_type: 'function',
      hook_type: 'function_call',
      stage,
      start_time: startNs,
      end_time: stage === 'completed' ? endNs : null,
      duration_ns: stage === 'completed' ? durationNs : null,
      status: { code: description ? 'ERROR' : 'UNSET', description },
      events: [],
      error: description,
      attributes: { 'openbox.span_type': 'function' },
      function: opts.name,
      module: opts.module ?? 'copilotkit',
      args: serializeArg(opts.args),
      result: stage === 'completed' ? serializeArg(opts.result) : null,
      ...(store.activityId ? { activity_id: store.activityId } : {}),
    }) as unknown as SpanData;
  store.spans.push(make('started'), make('completed'));
}

function headersToRecord(headers: Headers | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function toHeaders(value: unknown): Headers | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    return new Headers(value as HeadersInit);
  } catch {
    return undefined;
  }
}

function safeJsonParse(text: string | undefined): unknown {
  if (typeof text !== 'string' || text.trim() === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Assemble a streamed chat.completion (SSE `data: {chunk}` … `data: [DONE]`)
 * into the single chat.completion object the non-streaming API returns, so the
 * captured response_body matches the reference shape ({id, choices:[{message}],
 * usage}) instead of raw event-stream chunks. Returns undefined if the text is
 * not a recognizable OpenAI stream.
 */
function assembleStreamedCompletion(text: string): unknown {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'));
  if (lines.length === 0) return undefined;
  let base: Record<string, unknown> | undefined;
  let usage: unknown;
  const choices = new Map<
    number,
    {
      index: number;
      message: {
        role: string;
        content: string | null;
        tool_calls?: Array<{
          id?: string;
          type?: string;
          function: { name: string; arguments: string };
        }>;
      };
      finish_reason: string | null;
    }
  >();
  let sawChunk = false;
  for (const line of lines) {
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') continue;
    let chunk: Record<string, unknown>;
    try {
      chunk = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (chunk.object !== 'chat.completion.chunk') return undefined;
    sawChunk = true;
    if (!base) {
      base = {
        id: chunk.id,
        object: 'chat.completion',
        created: chunk.created,
        model: chunk.model,
        ...(chunk.service_tier !== undefined
          ? { service_tier: chunk.service_tier }
          : {}),
        system_fingerprint: chunk.system_fingerprint ?? null,
      };
    }
    if (chunk.usage) usage = chunk.usage;
    for (const choice of (chunk.choices as Array<Record<string, any>>) ?? []) {
      const index = Number(choice.index ?? 0);
      const acc =
        choices.get(index) ??
        ({
          index,
          message: { role: 'assistant', content: null },
          finish_reason: null,
        } as ReturnType<typeof choices.get> & object);
      const delta = (choice.delta ?? {}) as Record<string, any>;
      if (delta.role) acc.message.role = delta.role;
      if (delta.content != null) {
        acc.message.content = (acc.message.content ?? '') + delta.content;
      }
      if (Array.isArray(delta.tool_calls)) {
        acc.message.tool_calls = acc.message.tool_calls ?? [];
        for (const tc of delta.tool_calls) {
          const ti = Number(tc.index ?? 0);
          const existing = acc.message.tool_calls[ti] ?? {
            type: 'function',
            function: { name: '', arguments: '' },
          };
          if (tc.id) existing.id = tc.id;
          if (tc.type) existing.type = tc.type;
          if (tc.function?.name) existing.function.name += tc.function.name;
          if (tc.function?.arguments) {
            existing.function.arguments += tc.function.arguments;
          }
          acc.message.tool_calls[ti] = existing;
        }
      }
      if (choice.finish_reason) acc.finish_reason = choice.finish_reason;
      choices.set(index, acc);
    }
  }
  if (!base || !sawChunk) return undefined;
  base.choices = [...choices.values()]
    .sort((a, b) => a.index - b.index)
    .map((c) => ({
      index: c.index,
      message: c.message,
      logprobs: null,
      finish_reason: c.finish_reason,
    }));
  base.usage = usage ?? null;
  return base;
}

/**
 * Parse a captured LLM response body: JSON when the response is a single
 * object, or an assembled chat.completion when the response is an SSE stream.
 */
function parseLLMResponseBody(
  text: string,
  headers: Headers | undefined,
): unknown {
  const contentType = headers?.get('content-type') ?? '';
  const looksStreamed =
    contentType.includes('text/event-stream') || /^\s*data:/.test(text);
  if (looksStreamed) {
    const assembled = assembleStreamedCompletion(text);
    if (assembled !== undefined) return assembled;
  }
  return safeJsonParse(text);
}

function bodyText(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return body;
  try {
    return typeof body === 'object' ? JSON.stringify(body) : String(body);
  } catch {
    return undefined;
  }
}

const DEFAULT_LLM_URL_PATTERN =
  /\/(chat\/completions|responses|messages|generateContent|embeddings)\b/;

let globalFetchPatched = false;

/**
 * SDK-owned wiring: instrument the global `fetch` once so every sub-operation
 * HTTP call inside a governed tool is captured without the host injecting a
 * per-client fetch. LLM-provider calls are captured as exchanges (turned into
 * llm_completion span pairs by the governed tool); all other HTTP calls become
 * http_request span pairs. Idempotent.
 */
export function registerOpenBoxOtel(
  options: { urlPattern?: RegExp } = {},
): void {
  if (globalFetchPatched) return;
  globalFetchPatched = true;
  const llmPattern = options.urlPattern ?? DEFAULT_LLM_URL_PATTERN;
  const baseFetch = globalThis.fetch?.bind(globalThis);
  if (typeof baseFetch !== 'function') return;
  const instrumented = createInstrumentedFetch(baseFetch, llmPattern);
  globalThis.fetch = ((input: Request | string | URL, init?: RequestInit) =>
    instrumented(input as RequestInfo, init)) as typeof fetch;
}

function urlOf(input: Request | string | URL): string {
  return typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : ((input as Request)?.url ?? '');
}

/**
 * Wrap a `fetch` so each LLM provider call is recorded as an LLM exchange and
 * every other call is recorded as an http_request span pair, into the active
 * capture scope. Calls to ignored URLs (the OpenBox API) pass through untouched.
 */
export function createInstrumentedFetch(
  baseFetch: typeof fetch = globalThis.fetch,
  llmPattern: RegExp = DEFAULT_LLM_URL_PATTERN,
): typeof fetch {
  return (async (
    input: Request | string | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const store = captureStore.getStore();
    const url = urlOf(input);
    const ignored = store?.ignoredUrlPrefixes.some((p) => url.startsWith(p));
    if (!store || ignored) {
      return baseFetch(input as RequestInfo, init);
    }
    return llmPattern.test(url)
      ? captureLLMExchange(baseFetch, input, init, url, store)
      : captureHttpSpan(baseFetch, input, init, url, store);
  }) as unknown as typeof fetch;
}

/**
 * Back-compat: a fetch wrapper that only captures LLM exchanges (telemetry).
 * Prefer `registerOpenBoxOtel()` to instrument globally with no host wiring.
 */
export function createCapturingFetch(
  baseFetch: typeof fetch = globalThis.fetch,
): typeof fetch {
  return (async (
    input: Request | string | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const store = captureStore.getStore();
    const url = urlOf(input);
    if (!store) return baseFetch(input as RequestInfo, init);
    return captureLLMExchange(baseFetch, input, init, url, store);
  }) as unknown as typeof fetch;
}

function requestParts(
  input: Request | string | URL,
  init?: RequestInit,
): { method: string; requestHeaders: Record<string, string>; requestBody: unknown } {
  const inputRecord =
    input && typeof input === 'object' && !(input instanceof URL)
      ? (input as Request)
      : undefined;
  const method = String(
    init?.method ?? inputRecord?.method ?? 'POST',
  ).toUpperCase();
  const requestHeaders = headersToRecord(
    toHeaders(init?.headers) ?? inputRecord?.headers,
  );
  const requestBody = safeJsonParse(bodyText(init?.body));
  return { method, requestHeaders, requestBody };
}

async function captureLLMExchange(
  baseFetch: typeof fetch,
  input: Request | string | URL,
  init: RequestInit | undefined,
  url: string,
  store: SubOpCaptureStore,
): Promise<Response> {
  const { method, requestHeaders, requestBody } = requestParts(input, init);
  const startTimeMs = Date.now();
  const span: Span = tracer.startSpan('POST', { kind: SpanKind.CLIENT });
  try {
    const response = await baseFetch(input as RequestInfo, init);
    const endTimeMs = Date.now();
    let responseBody: unknown;
    let responseHeaders: Record<string, string> = {};
    try {
      const clone = response.clone();
      responseHeaders = headersToRecord(clone.headers);
      responseBody = parseLLMResponseBody(await clone.text(), clone.headers);
    } catch {
      responseHeaders = headersToRecord(response.headers);
    }
    store.exchanges.push({
      method,
      url,
      requestBody,
      requestHeaders,
      responseBody,
      responseHeaders,
      httpStatusCode: response.status,
      startTimeMs,
      endTimeMs,
    });
    span.setAttribute('http.request.method', method);
    span.setAttribute('url.full', url);
    span.setAttribute('http.response.status_code', response.status);
    return response;
  } finally {
    span.end();
  }
}

async function captureHttpSpan(
  baseFetch: typeof fetch,
  input: Request | string | URL,
  init: RequestInit | undefined,
  url: string,
  store: SubOpCaptureStore,
): Promise<Response> {
  const { method, requestHeaders, requestBody } = requestParts(input, init);
  const startMs = Date.now();
  try {
    const response = await baseFetch(input as RequestInfo, init);
    const endMs = Date.now();
    let responseBody: unknown;
    let responseHeaders: Record<string, string> = {};
    try {
      const clone = response.clone();
      responseHeaders = headersToRecord(clone.headers);
      responseBody = safeJsonParse(await clone.text());
    } catch {
      responseHeaders = headersToRecord(response.headers);
    }
    recordOpSpanPair(
      'http',
      {
        method,
        url,
        request_headers: requestHeaders,
        request_body: truncateBody(requestBody),
      },
      {
        response_headers: responseHeaders,
        response_body: truncateBody(responseBody),
        http_status_code: response.status,
      },
      {
        startMs,
        endMs,
        error: response.status >= 400 ? `HTTP ${response.status}` : undefined,
      },
    );
    return response;
  } catch (error) {
    recordOpSpanPair(
      'http',
      {
        method,
        url,
        request_headers: requestHeaders,
        request_body: truncateBody(requestBody),
      },
      {},
      { startMs, endMs: Date.now(), error },
    );
    throw error;
  }
}
