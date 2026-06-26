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

function bodyText(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return body;
  try {
    return typeof body === 'object' ? JSON.stringify(body) : String(body);
  } catch {
    return undefined;
  }
}

/**
 * Wrap a `fetch` so each call is recorded as a real OTel CLIENT span and pushed
 * into the active capture scope. Pass the returned function as the OpenAI
 * client's `fetch` (LangChain: `new ChatOpenAI({ configuration: { fetch } })`).
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
        responseBody = safeJsonParse(await clone.text());
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
