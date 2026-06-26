// Genuine OpenTelemetry capture of the real LLM HTTP exchange.
//
// The CopilotKit runtime/pipeline only sees AG-UI deltas, so it can never carry
// the real provider request/response (headers like cf-ray/x-request-id, the raw
// response JSON with system_fingerprint/service_tier, full usage). Those only
// exist at the HTTP client. This module instruments the OpenAI client's `fetch`
// with a real OTel CLIENT span and records the exchange so the governance
// `llm_completion` span can mirror the Temporal/OTel reference exactly.
//
// Correlation: the capturing fetch runs inside the same async call stack as the
// LangChain middleware's `handler(request)`, so an AsyncLocalStorage store keyed
// to that call collects the exchange(s); the middleware then reads the latest.

import { AsyncLocalStorage } from 'node:async_hooks';
import { SpanKind, trace, type Span } from '@opentelemetry/api';

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

type CaptureStore = { exchanges: CapturedLLMExchange[] };

const captureStore = new AsyncLocalStorage<CaptureStore>();
const tracer = trace.getTracer('openbox-copilotkit-llm');

/** Run `fn` inside a capture scope so the instrumented fetch can record into it. */
export function runWithLLMCapture<T>(fn: () => Promise<T>): Promise<T> {
  return captureStore.run({ exchanges: [] }, fn);
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
    contentType.includes('text/event-stream') ||
    /^\s*data:/.test(text);
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
 * SDK-owned wiring: instrument the global `fetch` once so every LLM provider
 * call is captured without the host injecting a per-client fetch. This mirrors
 * the Temporal/OTel reference (global instrumentation at the HTTP layer). Only
 * requests whose URL matches `urlPattern` are wrapped; all other traffic passes
 * through untouched. Idempotent.
 */
export function registerOpenBoxOtel(
  options: { urlPattern?: RegExp } = {},
): void {
  if (globalFetchPatched) return;
  globalFetchPatched = true;
  const pattern = options.urlPattern ?? DEFAULT_LLM_URL_PATTERN;
  const baseFetch = globalThis.fetch?.bind(globalThis);
  if (typeof baseFetch !== 'function') return;
  const capturing = createCapturingFetch(baseFetch);
  globalThis.fetch = ((input: Request | string | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request)?.url ?? '';
    return pattern.test(url)
      ? capturing(input as RequestInfo, init)
      : baseFetch(input as RequestInfo, init);
  }) as typeof fetch;
}

/**
 * Wrap a `fetch` so each call is recorded as a real OTel CLIENT span and pushed
 * into the active capture scope. Pass the returned function as the OpenAI
 * client's `fetch` (LangChain: `new ChatOpenAI({ configuration: { fetch } })`),
 * or prefer `registerOpenBoxOtel()` to instrument globally with no host wiring.
 */
export function createCapturingFetch(
  baseFetch: typeof fetch = globalThis.fetch,
): typeof fetch {
  return (async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
    const store = captureStore.getStore();
    const inputRecord =
      input && typeof input === 'object' && !(input instanceof URL)
        ? (input as Request)
        : undefined;
    const method = String(
      init?.method ?? inputRecord?.method ?? 'POST',
    ).toUpperCase();
    const url = String(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : inputRecord?.url ?? '',
    );
    const requestHeaders = headersToRecord(
      toHeaders(init?.headers) ?? inputRecord?.headers,
    );
    const requestBody = safeJsonParse(bodyText(init?.body));
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
        // Streaming / non-clonable bodies: keep headers + status; the caller
        // fills the body from the model response (AIMessage) instead.
        responseHeaders = headersToRecord(response.headers);
      }
      const exchange: CapturedLLMExchange = {
        method,
        url,
        requestBody,
        requestHeaders,
        responseBody,
        responseHeaders,
        httpStatusCode: response.status,
        startTimeMs,
        endTimeMs,
      };
      store?.exchanges.push(exchange);
      span.setAttribute('http.request.method', method);
      span.setAttribute('url.full', url);
      span.setAttribute('http.response.status_code', response.status);
      return response;
    } finally {
      span.end();
    }
  }) as unknown as typeof fetch;
}
