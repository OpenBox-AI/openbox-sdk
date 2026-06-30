import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  capturedLLMExchanges,
  capturedSubOpSpans,
  createCapturingFetch,
  createInstrumentedFetch,
  isCapturing,
  latestCapturedLLMExchange,
  parentSpanIdForActivity,
  recordDatabaseQuery,
  recordFileOperation,
  recordFunctionCall,
  registerOpenBoxOtel,
  runWithLLMCapture,
  runWithSubOpCapture,
} from '../../ts/src/copilotkit/otel-capture.js';

const OTEL_MODULE = '../../ts/src/copilotkit/otel-capture.js';

// ── small helpers ───────────────────────────────────────────────────────────

/** A baseFetch stub that returns the given Response (or a default 200). */
function fetchReturning(response: unknown): typeof fetch {
  return (async () => response) as unknown as typeof fetch;
}

/** A baseFetch stub that rejects. */
function fetchRejecting(error: unknown): typeof fetch {
  return (async () => {
    throw error;
  }) as unknown as typeof fetch;
}

function makeResponse(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: init.headers ?? {},
  });
}

// ── truncateFileData / recordFileOperation completed fields ──────────────────

describe('recordFileOperation → truncateFileData + completed field branches', () => {
  test('data null → undefined; long data truncated; non-string coerced; bytes/lines/operations', async () => {
    const spans = await runWithSubOpCapture({ activityId: 'file-1' }, async () => {
      // data === null → truncateFileData returns undefined (line 143)
      recordFileOperation({
        filePath: '/a',
        operation: 'read',
        data: null,
        bytesRead: 10,
        startMs: 1,
        endMs: 2,
      });
      // long string data → truncated (lines 145-146)
      recordFileOperation({
        filePath: '/b',
        operation: 'write',
        data: 'x'.repeat(5000),
        bytesWritten: 5000,
        linesCount: 3,
        operations: ['write', 'flush'],
        startMs: 1,
        endMs: 2,
      });
      // non-string data → String(value) (line 144), short → not truncated (line 147)
      recordFileOperation({
        filePath: '/c',
        operation: 'readlines',
        data: 12345,
        startMs: 1,
        endMs: 2,
      });
      return capturedSubOpSpans();
    });

    const completed = spans.filter(
      (s) => (s as unknown as { stage: string }).stage === 'completed',
    );
    const byPath = (p: string) =>
      completed.find(
        (s) => (s as unknown as { file_path: string }).file_path === p,
      ) as unknown as Record<string, unknown>;

    expect(byPath('/a').data).toBeUndefined();
    expect((byPath('/b').data as string).endsWith('...[truncated]')).toBe(true);
    expect((byPath('/b').data as string).length).toBe(4096 + '...[truncated]'.length);
    expect(byPath('/b').bytes_written).toBe(5000);
    expect(byPath('/b').lines_count).toBe(3);
    expect(byPath('/b').operations).toEqual(['write', 'flush']);
    expect(byPath('/c').data).toBe('12345');
  });

  test('delete operation maps to file_delete span type', async () => {
    const spans = await runWithSubOpCapture({ activityId: 'file-2' }, async () => {
      recordFileOperation({
        filePath: '/d',
        operation: 'delete',
        startMs: 1,
        endMs: 2,
      });
      return capturedSubOpSpans();
    });
    expect(spans.some((s) => s.name === 'file.delete')).toBe(true);
  });

  test('close operation maps to file_open span type', async () => {
    const spans = await runWithSubOpCapture({ activityId: 'file-3' }, async () => {
      recordFileOperation({
        filePath: '/e',
        operation: 'close',
        fileMode: 'w',
        startMs: 1,
        endMs: 2,
      });
      return capturedSubOpSpans();
    });
    expect(spans.some((s) => s.name === 'file.open')).toBe(true);
  });
});

// ── errorString branches (via record* error option) ─────────────────────────

describe('errorString branches', () => {
  test('Error with message, Error with empty message, string, and non-string errors', async () => {
    const spans = await runWithSubOpCapture({ activityId: 'err-1' }, async () => {
      // Error instance with message → error.message (line 263 left)
      recordFileOperation({
        filePath: '/x',
        operation: 'read',
        error: new Error('boom'),
        startMs: 1,
        endMs: 2,
      });
      // Error instance with empty message → falls back to error.name (line 263 right)
      recordDatabaseQuery({
        statement: 'SELECT 1',
        operation: 'SELECT',
        system: 'sqlite',
        error: new Error(''),
        startMs: 1,
        endMs: 2,
      });
      // string error (line 264 left)
      recordDatabaseQuery({
        statement: 'SELECT 2',
        operation: 'SELECT',
        system: 'sqlite',
        error: 'plain-string-error',
        startMs: 1,
        endMs: 2,
      });
      // non-string, non-Error error → String(error) (line 264 right) via recordFunctionCall
      recordFunctionCall({
        name: 'fn',
        args: [1],
        error: 42,
        startMs: 1,
        endMs: 2,
      });
      return capturedSubOpSpans();
    });

    const completed = spans.filter(
      (s) => (s as unknown as { stage: string }).stage === 'completed',
    );
    const errors = completed.map(
      (s) => (s as unknown as { error: unknown }).error,
    );
    expect(errors).toContain('boom');
    expect(errors).toContain('Error'); // empty message → name
    expect(errors).toContain('plain-string-error');
    expect(errors).toContain('42');
  });
});

// ── record* called with no active capture scope (early returns) ───────────────

describe('record helpers with no active scope', () => {
  test('recordFileOperation / recordDatabaseQuery / recordFunctionCall no-op', () => {
    expect(isCapturing()).toBe(false);
    // recordOpSpanPair early return (line 215)
    recordFileOperation({ filePath: '/n', operation: 'read', startMs: 1, endMs: 2 });
    recordDatabaseQuery({ statement: 'X', startMs: 1, endMs: 2 });
    // recordFunctionCall early return (line 400)
    recordFunctionCall({ name: 'noop', startMs: 1, endMs: 2 });
    expect(capturedSubOpSpans()).toEqual([]);
    expect(capturedLLMExchanges()).toEqual([]);
    expect(latestCapturedLLMExchange()).toBeUndefined();
  });
});

// ── recordDatabaseQuery field branches ───────────────────────────────────────

describe('recordDatabaseQuery branches', () => {
  test('rowcount omitted when negative; server fields propagated', async () => {
    const spans = await runWithSubOpCapture({ activityId: 'db-1' }, async () => {
      recordDatabaseQuery({
        statement: 'SELECT * FROM t',
        operation: 'SELECT',
        system: 'postgresql',
        dbName: 'app',
        serverAddress: 'db.local',
        serverPort: 5432,
        rowcount: -1, // negative → not recorded (line 364 false)
        startMs: 1,
        endMs: 2,
      });
      return capturedSubOpSpans();
    });
    const completed = spans.find(
      (s) => (s as unknown as { stage: string }).stage === 'completed',
    ) as unknown as Record<string, unknown>;
    expect(completed.rowcount).toBeNull();
    expect(completed.server_address).toBe('db.local');
    expect(completed.server_port).toBe(5432);
  });

  test('rowcount recorded when non-negative', async () => {
    const spans = await runWithSubOpCapture({ activityId: 'db-2' }, async () => {
      recordDatabaseQuery({
        statement: 'SELECT 1',
        operation: 'SELECT',
        system: 'sqlite',
        rowcount: 7,
        startMs: 1,
        endMs: 2,
      });
      return capturedSubOpSpans();
    });
    const completed = spans.find(
      (s) => (s as unknown as { stage: string }).stage === 'completed',
    ) as unknown as Record<string, unknown>;
    expect(completed.rowcount).toBe(7);
  });
});

// ── recordFunctionCall → serializeArg branches ───────────────────────────────

describe('recordFunctionCall → serializeArg branches', () => {
  test('undefined arg, circular arg, object/number/string/long args, with module', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const spans = await runWithSubOpCapture({ activityId: 'fn-1' }, async () => {
      recordFunctionCall({
        name: 'doThing',
        module: 'mymod',
        args: [
          undefined, // serializeArg → undefined (line 370)
          'plain', // string branch (line 374)
          { a: 1 }, // object → JSON.stringify (line 377)
          98765, // number → String (line 378)
          'y'.repeat(2500), // long → truncated (line 382 true)
          circular, // unserializable → '<unserializable>' (line 380)
        ],
        result: { ok: true },
        startMs: 1,
        endMs: 2,
      });
      return capturedSubOpSpans();
    });

    const completed = spans.find(
      (s) => (s as unknown as { stage: string }).stage === 'completed',
    ) as unknown as { attributes: Record<string, unknown>; module: string };
    expect(completed.module).toBe('mymod');
    expect(completed.attributes['code.namespace']).toBe('mymod');
    expect(completed.attributes['function.arg.0']).toBeUndefined();
    expect(completed.attributes['function.arg.1']).toBe('plain');
    expect(completed.attributes['function.arg.2']).toBe('{"a":1}');
    expect(completed.attributes['function.arg.3']).toBe('98765');
    expect(
      (completed.attributes['function.arg.4'] as string).endsWith('...[truncated]'),
    ).toBe(true);
    expect(completed.attributes['function.arg.5']).toBe('<unserializable>');
  });

  test('no module (default), non-array args, undefined result', async () => {
    const spans = await runWithSubOpCapture({ activityId: 'fn-2' }, async () => {
      recordFunctionCall({
        name: 'bare',
        // args undefined → not array (line 434 false → []); result undefined (line 370)
        startMs: 1,
        endMs: 2,
      });
      return capturedSubOpSpans();
    });
    const completed = spans.find(
      (s) => (s as unknown as { stage: string }).stage === 'completed',
    ) as unknown as { attributes: Record<string, unknown>; module: string };
    expect(completed.module).toBe('copilotkit');
    expect('code.namespace' in completed.attributes).toBe(false);
    expect(completed.attributes['function.result']).toBeUndefined();
  });
});

// ── runWithLLMCapture / no-activity scope (parent_span_id null) ───────────────

describe('runWithLLMCapture and activity-less scope', () => {
  test('captured spans get null parent when no activityId', async () => {
    const spans = await runWithLLMCapture(async () => {
      expect(isCapturing()).toBe(true);
      recordFileOperation({ filePath: '/p', operation: 'read', startMs: 1, endMs: 2 });
      recordFunctionCall({ name: 'f', args: [], startMs: 1, endMs: 2 });
      return capturedSubOpSpans();
    });
    for (const s of spans) {
      expect((s as unknown as { parent_span_id: unknown }).parent_span_id).toBeNull();
      expect('activity_id' in (s as object)).toBe(false);
    }
  });

  test('defaultIgnoredUrlPrefixes filters out unset env vars', async () => {
    const core = process.env.OPENBOX_CORE_URL;
    const api = process.env.OPENBOX_API_URL;
    delete process.env.OPENBOX_CORE_URL;
    delete process.env.OPENBOX_API_URL;
    try {
      const calls: string[] = [];
      const base = (async (input: unknown) => {
        calls.push(String(input));
        return makeResponse('{}', { headers: { 'content-type': 'application/json' } });
      }) as unknown as typeof fetch;
      const f = createInstrumentedFetch(base);
      await runWithLLMCapture(async () => {
        // No ignored prefixes now → example.com is captured as http span
        await f('https://example.com/plain');
      });
      expect(calls).toContain('https://example.com/plain');
    } finally {
      if (core !== undefined) process.env.OPENBOX_CORE_URL = core;
      if (api !== undefined) process.env.OPENBOX_API_URL = api;
    }
  });
});

// ── createInstrumentedFetch: passthrough branches ────────────────────────────

describe('createInstrumentedFetch passthrough', () => {
  test('no scope → passthrough', async () => {
    const calls: string[] = [];
    const base = (async (input: unknown) => {
      calls.push(String(input));
      return makeResponse('ok');
    }) as unknown as typeof fetch;
    const f = createInstrumentedFetch(base);
    await f('https://example.com/no-scope'); // line 714 (!store)
    expect(calls).toEqual(['https://example.com/no-scope']);
  });

  test('ignored url prefix → passthrough', async () => {
    const calls: string[] = [];
    const base = (async (input: unknown) => {
      calls.push(String(input));
      return makeResponse('ok');
    }) as unknown as typeof fetch;
    const f = createInstrumentedFetch(base);
    await runWithSubOpCapture(
      { activityId: 'ig-1', ignoredUrlPrefixes: ['https://ignored.example'] },
      async () => {
        await f('https://ignored.example/path'); // line 714 (ignored)
        expect(capturedSubOpSpans()).toEqual([]);
      },
    );
    expect(calls).toEqual(['https://ignored.example/path']);
  });
});

// ── createCapturingFetch ─────────────────────────────────────────────────────

describe('createCapturingFetch', () => {
  test('no scope → passthrough (line 735)', async () => {
    const calls: string[] = [];
    const base = (async (input: unknown) => {
      calls.push(String(input));
      return makeResponse('ok');
    }) as unknown as typeof fetch;
    const f = createCapturingFetch(base);
    await f('https://anything.example/x');
    expect(calls).toEqual(['https://anything.example/x']);
  });

  test('in scope → captures any url as LLM exchange', async () => {
    const base = fetchReturning(
      makeResponse(JSON.stringify({ ok: 1 }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    const f = createCapturingFetch(base);
    const ex = await runWithSubOpCapture({ activityId: 'cap-1' }, async () => {
      await f('https://not-an-llm.example/foo', {
        method: 'POST',
        body: JSON.stringify({ a: 1 }),
      });
      return latestCapturedLLMExchange();
    });
    expect(ex?.responseBody).toEqual({ ok: 1 });
    expect(ex?.requestBody).toEqual({ a: 1 });
  });
});

// ── captureLLMExchange: streamed/non-streamed response assembly ───────────────

describe('captureLLMExchange response parsing', () => {
  async function captureLLM(
    response: unknown,
    init?: RequestInit,
    url = 'https://api.openai.com/v1/chat/completions',
  ) {
    const f = createInstrumentedFetch(fetchReturning(response));
    return runWithSubOpCapture({ activityId: 'llm' }, async () => {
      await f(url, init);
      return latestCapturedLLMExchange();
    });
  }

  test('full SSE stream assembled into chat.completion (content, tool_calls, usage)', async () => {
    const sse = [
      'data: {"id":"x","object":"chat.completion.chunk","created":1,"model":"gpt-4","service_tier":"default","system_fingerprint":"fp","choices":[{"index":0,"delta":{"role":"assistant","content":"Hel"}}]}',
      'data: {"id":"x","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"lo","tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"foo"}}]}}]}',
      'data: {"id":"x","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}',
      'data: [DONE]',
      '',
    ].join('\n');
    const ex = await captureLLM(
      makeResponse(sse, { headers: { 'content-type': 'text/event-stream' } }),
    );
    const body = ex?.responseBody as Record<string, any>;
    expect(body.object).toBe('chat.completion');
    expect(body.service_tier).toBe('default');
    expect(body.system_fingerprint).toBe('fp');
    expect(body.choices[0].message.content).toBe('Hello');
    expect(body.choices[0].message.tool_calls[0].function.name).toBe('foo');
    expect(body.choices[0].message.tool_calls[0].function.arguments).toBe('{}');
    expect(body.choices[0].finish_reason).toBe('stop');
    expect(body.usage).toEqual({ prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 });
  });

  test('multi-choice stream → sort comparator; missing index/choices defaults', async () => {
    const sse = [
      // two choices → sort comparator runs (line 573)
      'data: {"id":"m","object":"chat.completion.chunk","model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"A"}},{"index":1,"delta":{"content":"B"}}]}',
      // choice without index → 0; tool_call without index → 0
      'data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":"C","tool_calls":[{"function":{"name":"f","arguments":"x"}}]}}]}',
      // chunk with no choices field → (chunk.choices ?? [])
      'data: {"object":"chat.completion.chunk"}',
      'data: {"object":"chat.completion.chunk","choices":[{"index":1,"delta":{"content":"D"},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ].join('\n');
    const ex = await captureLLM(
      makeResponse(sse, { headers: { 'content-type': 'text/event-stream' } }),
    );
    const body = ex?.responseBody as Record<string, any>;
    expect(body.choices.map((c: any) => c.index)).toEqual([0, 1]);
    expect(body.choices[0].message.content).toBe('AC');
    expect(body.choices[1].message.content).toBe('BD');
    expect(body.choices[0].message.tool_calls[0].function.name).toBe('f');
  });

  test('SSE detected via leading data: regex, no usage/service_tier/system_fingerprint', async () => {
    const sse = [
      'data: {"id":"y","object":"chat.completion.chunk","model":"gpt-4","choices":[{"index":0,"delta":{"content":"hi"}}]}',
      'data: [DONE]',
    ].join('\n');
    // content-type application/json → looksStreamed via /^\s*data:/ regex
    const ex = await captureLLM(
      makeResponse(sse, { headers: { 'content-type': 'application/json' } }),
    );
    const body = ex?.responseBody as Record<string, any>;
    expect(body.object).toBe('chat.completion');
    expect(body.system_fingerprint).toBeNull();
    expect(body.usage).toBeNull();
    expect(body.choices[0].message.content).toBe('hi');
  });

  test('event-stream with no data lines → falls back to safeJsonParse (line 492)', async () => {
    const ex = await captureLLM(
      makeResponse(': keepalive\n\nfoo', {
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
    expect(ex?.responseBody).toBe(': keepalive\n\nfoo');
  });

  test('only [DONE] → assemble returns undefined (line 571), fallback to text', async () => {
    const ex = await captureLLM(
      makeResponse('data: [DONE]', {
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
    expect(ex?.responseBody).toBe('data: [DONE]');
  });

  test('invalid json data line skipped then valid chunk assembled (line 519)', async () => {
    const sse = [
      'data: notjson',
      'data: {"id":"z","object":"chat.completion.chunk","model":"m","choices":[{"index":0,"delta":{"content":"ok"}}]}',
      'data: [DONE]',
    ].join('\n');
    const ex = await captureLLM(
      makeResponse(sse, { headers: { 'content-type': 'text/event-stream' } }),
    );
    expect((ex?.responseBody as Record<string, any>).choices[0].message.content).toBe('ok');
  });

  test('non-chunk object → assemble returns undefined (line 521)', async () => {
    const ex = await captureLLM(
      makeResponse('data: {"object":"other"}', {
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
    expect(ex?.responseBody).toBe('data: {"object":"other"}');
  });

  test('plain JSON (non-streamed) response parsed (line 599)', async () => {
    const ex = await captureLLM(
      makeResponse(JSON.stringify({ id: 'r', choices: [] }), {
        headers: { 'content-type': 'application/json' },
      }),
      { method: 'POST', body: JSON.stringify({ model: 'gpt-4' }) },
    );
    expect((ex?.responseBody as Record<string, any>).id).toBe('r');
    expect(ex?.requestBody).toEqual({ model: 'gpt-4' });
    expect(ex?.method).toBe('POST');
  });

  test('response with no content-type header → parseLLMResponseBody contentType ?? "" (line 592)', async () => {
    const fake = {
      status: 200,
      headers: new Headers(),
      clone() {
        return { headers: new Headers(), text: async () => '{"ok":true}' };
      },
    };
    const ex = await captureLLM(fake);
    expect(ex?.responseBody).toEqual({ ok: true });
  });

  test('stream choice with no delta → choice.delta ?? {} (line 545)', async () => {
    const sse = [
      'data: {"object":"chat.completion.chunk","model":"m","choices":[{"index":0,"finish_reason":"stop"}]}',
      'data: [DONE]',
    ].join('\n');
    const ex = await captureLLM(
      makeResponse(sse, { headers: { 'content-type': 'text/event-stream' } }),
    );
    const body = ex?.responseBody as Record<string, any>;
    expect(body.choices[0].message.content).toBeNull();
    expect(body.choices[0].finish_reason).toBe('stop');
  });

  test('empty-string request body → safeJsonParse undefined (line 472 right)', async () => {
    const ex = await captureLLM(
      makeResponse('{}', { headers: { 'content-type': 'application/json' } }),
      { method: 'POST', body: '' },
    );
    expect(ex?.requestBody).toBeUndefined();
  });

  test('response.clone throws → catch path keeps headers (line 778)', async () => {
    const fake = {
      status: 200,
      headers: new Headers({ 'x-req': '1' }),
      clone() {
        throw new Error('noclone');
      },
    };
    const ex = await captureLLM(fake);
    expect(ex?.responseBody).toBeUndefined();
    expect(ex?.responseHeaders['x-req']).toBe('1');
    expect(ex?.httpStatusCode).toBe(200);
  });
});

// ── captureHttpSpan: request body shaping + response handling ─────────────────

describe('captureHttpSpan request/response body branches', () => {
  async function captureHttp(
    response: unknown,
    input: Request | string | URL,
    init?: RequestInit,
    base?: typeof fetch,
  ) {
    const f = createInstrumentedFetch(base ?? fetchReturning(response));
    return runWithSubOpCapture({ activityId: 'http' }, async () => {
      const result = await f(input, init).catch((e) => {
        throw e;
      });
      return { spans: capturedSubOpSpans(), result };
    });
  }

  function completedHttp(spans: ReturnType<typeof capturedSubOpSpans>) {
    return spans.find(
      (s) => (s as unknown as { stage: string }).stage === 'completed',
    ) as unknown as Record<string, unknown>;
  }
  function startedHttp(spans: ReturnType<typeof capturedSubOpSpans>) {
    return spans.find(
      (s) => (s as unknown as { stage: string }).stage === 'started',
    ) as unknown as Record<string, unknown>;
  }

  test('string body request, text response captured & status<400', async () => {
    const { spans } = await captureHttp(
      makeResponse('response-text', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
      'https://example.com/api',
      { method: 'PUT', body: 'request-text', headers: { 'x-h': 'v' } },
    );
    expect(startedHttp(spans).request_body).toBe('request-text');
    expect(completedHttp(spans).response_body).toBe('response-text');
    expect(completedHttp(spans).error).toBeNull();
  });

  test('URLSearchParams body → toString (line 616)', async () => {
    const { spans } = await captureHttp(
      makeResponse('', { headers: { 'content-type': 'text/plain' } }),
      'https://example.com/api',
      { method: 'POST', body: new URLSearchParams({ a: '1', b: '2' }) },
    );
    expect(startedHttp(spans).request_body).toBe('a=1&b=2');
  });

  test('typed-array body → undefined (ArrayBuffer.isView, line 616 right)', async () => {
    const { spans } = await captureHttp(
      makeResponse('', { headers: { 'content-type': 'text/plain' } }),
      'https://example.com/api',
      { method: 'POST', body: new Uint8Array([1, 2, 3]) },
    );
    expect(startedHttp(spans).request_body).toBeNull();
  });

  test('ArrayBuffer body → undefined', async () => {
    const { spans } = await captureHttp(
      makeResponse('', { headers: { 'content-type': 'text/plain' } }),
      'https://example.com/api',
      { method: 'POST', body: new ArrayBuffer(4) },
    );
    expect(startedHttp(spans).request_body).toBeNull();
  });

  test('plain object body → JSON.stringify (line 619)', async () => {
    const { spans } = await captureHttp(
      makeResponse('', { headers: { 'content-type': 'text/plain' } }),
      'https://example.com/api',
      { method: 'POST', body: { hello: 'world' } as unknown as BodyInit },
    );
    expect(startedHttp(spans).request_body).toBe('{"hello":"world"}');
  });

  test('circular object body → undefined (line 620-622 catch)', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const { spans } = await captureHttp(
      makeResponse('', { headers: { 'content-type': 'text/plain' } }),
      'https://example.com/api',
      { method: 'POST', body: circular as unknown as BodyInit },
    );
    expect(startedHttp(spans).request_body).toBeNull();
  });

  test('number body → String (line 624)', async () => {
    const { spans } = await captureHttp(
      makeResponse('', { headers: { 'content-type': 'text/plain' } }),
      'https://example.com/api',
      { method: 'POST', body: 12345 as unknown as BodyInit },
    );
    expect(startedHttp(spans).request_body).toBe('12345');
  });

  test('long string body truncated (line 269-271)', async () => {
    const { spans } = await captureHttp(
      makeResponse('', { headers: { 'content-type': 'text/plain' } }),
      'https://example.com/api',
      { method: 'POST', body: 'q'.repeat(9000) },
    );
    expect((startedHttp(spans).request_body as string).endsWith('...[truncated]')).toBe(
      true,
    );
  });

  test('Request object input with body → captureRequestBodyString clone().text() (lines 651-656)', async () => {
    const req = new Request('https://example.com/req', {
      method: 'POST',
      body: 'from-request-body',
    });
    const { spans } = await captureHttp(
      makeResponse('', { headers: { 'content-type': 'text/plain' } }),
      req,
    );
    expect(startedHttp(spans).request_body).toBe('from-request-body');
    expect((startedHttp(spans) as Record<string, unknown>).http_method).toBe('POST');
  });

  test('Request-like whose clone throws → undefined (lines 657-659)', async () => {
    const fakeReq = {
      url: 'https://example.com/badreq',
      method: 'POST',
      headers: new Headers(),
      body: {},
      clone() {
        throw new Error('noclone');
      },
    } as unknown as Request;
    const { spans } = await captureHttp(
      makeResponse('', { headers: { 'content-type': 'text/plain' } }),
      fakeReq,
    );
    expect(startedHttp(spans).request_body).toBeNull();
  });

  test('URL object input, no body → request_body undefined (line 661)', async () => {
    const { spans } = await captureHttp(
      makeResponse('', { headers: { 'content-type': 'text/plain' } }),
      new URL('https://example.com/urlinput'),
      { method: 'GET' },
    );
    expect(startedHttp(spans).request_body).toBeNull();
    expect(startedHttp(spans).http_method).toBe('GET');
  });

  test('string input, no init body → request_body undefined (line 661)', async () => {
    const { spans } = await captureHttp(
      makeResponse('', { headers: { 'content-type': 'text/plain' } }),
      'https://example.com/plainstring',
    );
    expect(startedHttp(spans).request_body).toBeNull();
    // method defaults to POST when neither init nor request specify it
    expect(startedHttp(spans).http_method).toBe('POST');
  });

  test('no content-type response → isTextContentType true (line 630)', async () => {
    const { spans } = await captureHttp(
      makeResponse('body-no-ct'),
      'https://example.com/api',
    );
    expect(completedHttp(spans).response_body).toBe('body-no-ct');
  });

  test('response headers without content-type → isTextContentType !contentType true (line 630)', async () => {
    const fake = {
      status: 200,
      headers: new Headers(),
      clone() {
        return { headers: new Headers(), text: async () => 'plain-no-ct' };
      },
    };
    const { spans } = await captureHttp(fake, 'https://example.com/api', {
      method: 'GET',
    });
    expect(completedHttp(spans).response_body).toBe('plain-no-ct');
  });

  test('object input without url → urlOf falls back to "" (line 694)', async () => {
    const calls: unknown[] = [];
    const base = (async (input: unknown) => {
      calls.push(input);
      return makeResponse('', { headers: { 'content-type': 'text/plain' } });
    }) as unknown as typeof fetch;
    const f = createInstrumentedFetch(base);
    const spans = await runWithSubOpCapture({ activityId: 'urlo' }, async () => {
      await f({} as unknown as Request);
      return capturedSubOpSpans();
    });
    // empty url → not LLM → http span with the canonical "HTTP {method}" name
    expect(spans.some((s) => String(s.name).startsWith('HTTP'))).toBe(true);
  });

  test('non-text content-type response body skipped', async () => {
    const { spans } = await captureHttp(
      makeResponse('binarydata', { headers: { 'content-type': 'image/png' } }),
      'https://example.com/api',
    );
    expect(completedHttp(spans).response_body).toBeUndefined();
  });

  test('status >= 400 → error string set (line 842 true)', async () => {
    const { spans } = await captureHttp(
      makeResponse('err', { status: 500, headers: { 'content-type': 'text/plain' } }),
      'https://example.com/api',
    );
    expect(completedHttp(spans).error).toBe('HTTP 500');
  });

  test('response.clone throws on http path → catch keeps headers (line 824)', async () => {
    const fake = {
      status: 200,
      headers: new Headers({ ct: 'x' }),
      clone() {
        throw new Error('noclone');
      },
    };
    const { spans } = await captureHttp(fake, 'https://example.com/api', {
      method: 'GET',
    });
    expect(completedHttp(spans).response_body).toBeUndefined();
    expect((completedHttp(spans).response_headers as Record<string, string>).ct).toBe('x');
  });

  test('baseFetch rejects → error span recorded and rethrown (lines 847-858)', async () => {
    const base = fetchRejecting(new Error('network-down'));
    await expect(
      captureHttp(undefined, 'https://example.com/api', { method: 'POST' }, base),
    ).rejects.toThrow('network-down');
  });
});

// ── toHeaders catch (invalid HeadersInit) ────────────────────────────────────

describe('toHeaders invalid headers', () => {
  test('invalid header name → toHeaders returns undefined (line 467)', async () => {
    const f = createInstrumentedFetch(
      fetchReturning(makeResponse('', { headers: { 'content-type': 'text/plain' } })),
    );
    const spans = await runWithSubOpCapture({ activityId: 'hdr-1' }, async () => {
      await f('https://example.com/api', {
        method: 'POST',
        headers: { 'Invalid Header Name': 'v' } as unknown as HeadersInit,
        body: 'x',
      });
      return capturedSubOpSpans();
    });
    const started = spans.find(
      (s) => (s as unknown as { stage: string }).stage === 'started',
    ) as unknown as Record<string, unknown>;
    // invalid headers were dropped → empty header map sanitizes to null
    expect(started.request_headers).toBeNull();
  });
});

// ── registerOpenBoxOtel ──────────────────────────────────────────────────────

describe('registerOpenBoxOtel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('returns early when global fetch is missing (line 683)', async () => {
    vi.resetModules();
    const mod = await import(OTEL_MODULE);
    const original = globalThis.fetch;
    // @ts-expect-error intentionally remove fetch
    globalThis.fetch = undefined;
    try {
      mod.registerOpenBoxOtel();
      expect(globalThis.fetch).toBeUndefined();
    } finally {
      globalThis.fetch = original;
    }
  });

  test('patches global fetch once, idempotent, wrapper delegates (lines 685-686, 679)', async () => {
    vi.resetModules();
    const mod = await import(OTEL_MODULE);
    const original = globalThis.fetch;
    const calls: string[] = [];
    const stub = (async (input: unknown) => {
      calls.push(String(input));
      return makeResponse('{}', { headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    globalThis.fetch = stub;
    try {
      mod.registerOpenBoxOtel({ urlPattern: /custom-llm/ }); // lines 684-686
      const patched = globalThis.fetch;
      expect(patched).not.toBe(stub);

      mod.registerOpenBoxOtel(); // idempotent early return (line 679)
      expect(globalThis.fetch).toBe(patched);

      // Drive the installed wrapper inside a capture scope (lines 685-686 body).
      await mod.runWithSubOpCapture({ activityId: 'reg-1' }, async () => {
        await (globalThis.fetch as typeof fetch)('https://example.com/data');
      });
      expect(calls).toContain('https://example.com/data');
    } finally {
      globalThis.fetch = original;
    }
  });
});

// ── parentSpanIdForActivity sanity ───────────────────────────────────────────

describe('parentSpanIdForActivity', () => {
  test('deterministic 16-hex digest', () => {
    const a = parentSpanIdForActivity('abc');
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(parentSpanIdForActivity('abc')).toBe(a);
  });
});
