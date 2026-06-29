import { describe, expect, test } from 'vitest';
import {
  buildLLMCompletionResponseBody,
  buildLLMCompletionSpan,
  buildSpan,
  leanCopilotLlmSpan,
  llmTokenUsageFromRecord,
  openBoxActivityMetadata,
  serverComputedSemanticType,
  stripServerComputedSemantic,
  withOpenBoxActivityMetadata,
  withOpenBoxSubagentActivityMetadata,
  withServerComputedSemantic,
  withSpanActivityId,
  type SpanType,
} from '../../ts/src/governance/spans.js';

// These tests drive the remaining uncovered helper + span-type branches in
// ts/src/governance/spans.ts purely through the module's exported API.

const attrs = (span: unknown): Record<string, unknown> =>
  (span as Record<string, unknown>).attributes as Record<string, unknown>;

const asRecord = (value: unknown): Record<string, unknown> =>
  value as unknown as Record<string, unknown>;

describe('errorDescription (via buildSpan error / buildLLMCompletionSpan)', () => {
  test('Error with a message uses the message', () => {
    expect(buildSpan('cursor', 'shell', { command: 'ls', error: new Error('boom') }).error).toBe(
      'boom',
    );
  });

  test('Error with no message falls back to the error name', () => {
    expect(buildSpan('cursor', 'shell', { command: 'ls', error: new Error('') }).error).toBe(
      'Error',
    );
  });

  test('whitespace-only string error becomes undefined (no error)', () => {
    expect(buildSpan('cursor', 'shell', { command: 'ls', error: '   ' }).error).toBeNull();
  });

  test('non-whitespace string error is trimmed and kept', () => {
    expect(buildSpan('cursor', 'shell', { command: 'ls', error: '  kaboom  ' }).error).toBe(
      'kaboom',
    );
  });

  test('null / undefined error yields no error', () => {
    expect(buildSpan('cursor', 'shell', { command: 'ls', error: null }).error).toBeNull();
    expect(buildSpan('cursor', 'shell', { command: 'ls', error: undefined }).error).toBeNull();
  });

  test('plain object error is JSON-stringified', () => {
    expect(buildSpan('cursor', 'shell', { command: 'ls', error: { code: 'E_FAIL' } }).error).toBe(
      JSON.stringify({ code: 'E_FAIL' }),
    );
  });

  test('value whose JSON.stringify is undefined falls back to String()', () => {
    const fn = function namedFn() {};
    expect(buildSpan('cursor', 'shell', { command: 'ls', error: fn }).error).toBe(String(fn));
  });

  test('circular object error is caught and stringified via String()', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(buildSpan('cursor', 'shell', { command: 'ls', error: circular }).error).toBe(
      String(circular),
    );
  });
});

describe('withSpanActivityId', () => {
  test('returns input unchanged when activityId is missing', () => {
    const span = { foo: 'bar' };
    expect(withSpanActivityId(span)).toBe(span);
    expect(withSpanActivityId(span, '')).toBe(span);
  });

  test('returns input unchanged for non-object / array spans', () => {
    expect(withSpanActivityId(null, 'a')).toBeNull();
    const arr = [1, 2, 3];
    expect(withSpanActivityId(arr, 'a')).toBe(arr);
  });

  test('does not overwrite an existing non-empty activity_id', () => {
    const span = { activity_id: 'existing' };
    expect(withSpanActivityId(span, 'new')).toBe(span);
  });

  test('replaces an empty/whitespace activity_id and adds when absent', () => {
    const replaced = withSpanActivityId({ activity_id: '   ', x: 1 }, 'fresh') as Record<
      string,
      unknown
    >;
    expect(replaced.activity_id).toBe('fresh');
    const added = withSpanActivityId({ x: 1 }, 'fresh') as Record<string, unknown>;
    expect(added.activity_id).toBe('fresh');
  });
});

describe('parseJsonRecord (via buildLLMCompletionResponseBody responseBody)', () => {
  test('invalid JSON string responseBody is treated as empty record', () => {
    const parsed = JSON.parse(
      buildLLMCompletionResponseBody('hello', { responseBody: '{ not valid json' }),
    );
    expect(parsed.choices[0].message.content).toBe('hello');
  });

  test('valid JSON string responseBody is parsed', () => {
    const parsed = JSON.parse(
      buildLLMCompletionResponseBody('hello', { responseBody: JSON.stringify({ id: 'abc' }) }),
    );
    expect(parsed.id).toBe('abc');
    expect(parsed.choices[0].message.content).toBe('hello');
  });
});

describe('buildLLMCompletionResponseBody choices/content injection', () => {
  test('no choices array → synthesizes a choices array with content', () => {
    const parsed = JSON.parse(buildLLMCompletionResponseBody('synth', { responseBody: {} }));
    expect(parsed.choices).toEqual([{ message: { content: 'synth' } }]);
  });

  test('existing choices with empty content → injects content into first choice', () => {
    const parsed = JSON.parse(
      buildLLMCompletionResponseBody('injected', {
        responseBody: {
          choices: [
            { index: 0, message: { role: 'assistant', content: '' } },
            { index: 1, message: { content: 'second' } },
          ],
        },
        model: 'gpt-4',
        modelId: 'gpt-4',
        provider: 'openai',
        usage: { input_tokens: 1, output_tokens: 2 },
      }),
    );
    expect(parsed.choices[0].message.content).toBe('injected');
    expect(parsed.choices[0].message.role).toBe('assistant');
    expect(parsed.choices[1].message.content).toBe('second');
  });

  test('existing choices with non-empty content → leaves content untouched', () => {
    const parsed = JSON.parse(
      buildLLMCompletionResponseBody('ignored', {
        responseBody: { choices: [{ message: { content: 'keepme' } }] },
      }),
    );
    expect(parsed.choices[0].message.content).toBe('keepme');
  });

  test('existing choices but empty injected content → no injection branch', () => {
    const parsed = JSON.parse(
      buildLLMCompletionResponseBody('', { responseBody: { choices: [{ message: { content: '' } }] } }),
    );
    expect(parsed.choices[0].message.content).toBe('');
  });

  test('preserves pre-set model/provider/usage fields in responseBody', () => {
    const parsed = JSON.parse(
      buildLLMCompletionResponseBody('x', {
        responseBody: {
          choices: [{ message: { content: 'existing' } }],
          model: 'preset',
          model_id: 'preset-id',
          provider: 'preset-provider',
          model_provider: 'preset-mp',
          usage: { input_tokens: 9 },
        },
        model: 'override',
        modelId: 'override-id',
        provider: 'override-provider',
        usage: { input_tokens: 1 },
      }),
    );
    expect(parsed.model).toBe('preset');
    expect(parsed.usage.input_tokens).toBe(9);
  });
});

describe('llmTokenUsageFromRecord', () => {
  test('returns undefined when no usage fields present', () => {
    expect(llmTokenUsageFromRecord({ foo: 'bar' })).toBeUndefined();
    expect(llmTokenUsageFromRecord('not-an-object')).toBeUndefined();
  });

  test('extracts usage from a nested provider container', () => {
    const usage = llmTokenUsageFromRecord({ usage: { prompt_tokens: 5, completion_tokens: 7 } });
    expect(usage?.promptTokens).toBe(5);
    expect(usage?.completionTokens).toBe(7);
  });

  test('reads dotted alias paths', () => {
    const usage = llmTokenUsageFromRecord({
      input_tokens_details: { cached_tokens: 3 },
      input_tokens: 10,
    });
    expect(usage?.cacheReadInputTokens).toBe(3);
  });
});

describe('serverComputedSemanticType / withServerComputedSemantic', () => {
  test('http semantic types by method, with default and fallback', () => {
    expect(serverComputedSemanticType('http', { method: 'POST' })).toBe('http_post');
    expect(serverComputedSemanticType('http', { method: 'GET' })).toBe('http_get');
    expect(serverComputedSemanticType('http', {})).toBe('http_get'); // default GET
    expect(serverComputedSemanticType('http', { method: 'OPTIONS' })).toBe('http'); // httpDefault
  });

  test('db semantic types by operation, with default and fallback', () => {
    expect(serverComputedSemanticType('db', { db_operation: 'insert' })).toBe('database_insert');
    expect(serverComputedSemanticType('db', { operation: 'update' })).toBe('database_update');
    expect(serverComputedSemanticType('db', {})).toBe('database_query'); // 'query' → dbDefault
    expect(serverComputedSemanticType('db', { db_operation: 'merge' })).toBe('database_query');
  });

  test('static span types and unknown-type fallback', () => {
    expect(serverComputedSemanticType('shell')).toBe('internal');
    expect(serverComputedSemanticType('file_read')).toBe('file_read');
    // Unknown type exercises the `staticMap[type] ?? type` fallback.
    expect(serverComputedSemanticType('totally-unknown' as SpanType)).toBe('totally-unknown');
  });

  test('withServerComputedSemantic stamps the computed semantic_type (default input)', () => {
    expect(asRecord(withServerComputedSemantic({ a: 1 }, 'shell')).semantic_type).toBe('internal');
    expect(
      asRecord(withServerComputedSemantic({ a: 1 }, 'http', { method: 'put' })).semantic_type,
    ).toBe('http_put');
  });
});

describe('stripServerComputedSemantic', () => {
  test('removes semantic_type and openbox.semantic_type from object attributes', () => {
    const out = stripServerComputedSemantic({
      semantic_type: 'x',
      semanticType: 'y',
      attributes: { 'openbox.semantic_type': 'z', keep: 1 },
    }) as Record<string, unknown>;
    expect(out.semantic_type).toBeUndefined();
    expect(out.semanticType).toBeUndefined();
    expect((out.attributes as Record<string, unknown>)['openbox.semantic_type']).toBeUndefined();
    expect((out.attributes as Record<string, unknown>).keep).toBe(1);
  });

  test('leaves non-object / missing attributes untouched (else branch)', () => {
    const noAttrs = stripServerComputedSemantic({ semantic_type: 'x', foo: 1 }) as Record<
      string,
      unknown
    >;
    expect(noAttrs.semantic_type).toBeUndefined();
    expect(noAttrs.attributes).toBeUndefined();
    const arrAttrs = stripServerComputedSemantic({ attributes: ['not', 'object'] }) as Record<
      string,
      unknown
    >;
    expect(arrAttrs.attributes).toEqual(['not', 'object']);
  });
});

describe('openBoxActivityMetadata helpers', () => {
  test('returns marker only when fields present, trims values', () => {
    expect(openBoxActivityMetadata({ toolType: '  a2a  ', subagentName: ' bob ' })).toEqual({
      __openbox: { tool_type: 'a2a', subagent_name: 'bob' },
    });
    expect(openBoxActivityMetadata({ toolType: '  ', subagentName: null })).toBeUndefined();
    expect(openBoxActivityMetadata({})).toBeUndefined();
  });

  test('withOpenBoxActivityMetadata appends marker or returns input unchanged', () => {
    const appended = withOpenBoxActivityMetadata(['x'], { toolType: 'a2a' }) as unknown[];
    expect(appended).toHaveLength(2);
    const unchanged = ['x'];
    expect(withOpenBoxActivityMetadata(unchanged, {})).toBe(unchanged);
    // undefined input + marker → spreads from empty.
    expect((withOpenBoxActivityMetadata(undefined, { subagentName: 'z' }) as unknown[]).length).toBe(
      1,
    );
  });

  test('withOpenBoxSubagentActivityMetadata sets a2a tool type', () => {
    const out = withOpenBoxSubagentActivityMetadata([], 'agent-1') as Array<{
      __openbox: { tool_type: string; subagent_name: string };
    }>;
    expect(out[0].__openbox.tool_type).toBe('a2a');
    expect(out[0].__openbox.subagent_name).toBe('agent-1');
    // toolType 'a2a' is always present, so a null subagent still yields a marker.
    const nullSub = withOpenBoxSubagentActivityMetadata(['keep'], null) as Array<{
      __openbox: { tool_type: string };
    }>;
    expect(nullSub).toHaveLength(2);
    expect(nullSub[1].__openbox.tool_type).toBe('a2a');
  });
});

describe('provider normalization & inference', () => {
  test('explicit provider: openai / anthropic / google(+gemini) / passthrough', () => {
    expect(attrs(buildLLMCompletionSpan({ content: 'x', provider: 'OpenAI' }))['openbox.model.provider']).toBe('openai');
    expect(attrs(buildLLMCompletionSpan({ content: 'x', provider: 'Anthropic Claude' }))['openbox.model.provider']).toBe('anthropic');
    expect(attrs(buildLLMCompletionSpan({ content: 'x', provider: 'Google Vertex' }))['openbox.model.provider']).toBe('google');
    expect(attrs(buildLLMCompletionSpan({ content: 'x', provider: 'gemini-cloud' }))['openbox.model.provider']).toBe('google');
    expect(attrs(buildLLMCompletionSpan({ content: 'x', provider: 'mistral' }))['openbox.model.provider']).toBe('mistral');
  });

  test('whitespace-only provider yields no provider', () => {
    expect(
      attrs(buildLLMCompletionSpan({ content: 'x', provider: '   ', model: 'mysterymodel' }))[
        'openbox.model.provider'
      ],
    ).toBeUndefined();
  });

  test('provider parsed from "provider/model" identifier', () => {
    const span = buildLLMCompletionSpan({ content: 'x', model: 'anthropic/claude-3' });
    expect(attrs(span)['openbox.model.provider']).toBe('anthropic');
    expect(attrs(span)['openbox.model.id']).toBe('claude-3');
  });

  test('slash identifier with empty provider segment falls through to full model id', () => {
    // Leading-slash model: the provider segment is empty, so parseModelIdentifier
    // does not split it into provider/model (exercises the no-split else path).
    const span = buildLLMCompletionSpan({ content: 'x', model: '/gpt-4' });
    expect(attrs(span)['openbox.model.id']).toBe('/gpt-4');
    expect(attrs(span)['openbox.model.provider']).toBeUndefined();
  });

  test('inferProviderFromModelId: gpt-/o1/o3/o4 → openai, claude- → anthropic, gemini → google', () => {
    const cases: Array<[string, string | undefined]> = [
      ['gpt-4o', 'openai'],
      ['o1-preview', 'openai'],
      ['o3-mini', 'openai'],
      ['o4-mega', 'openai'],
      ['claude-opus-4', 'anthropic'],
      ['gemini-1.5-pro', 'google'],
      ['mysterymodel', undefined],
    ];
    for (const [model, provider] of cases) {
      expect(attrs(buildSpan('cursor', 'llm', { model, prompt: 'hi' }))['openbox.model.provider']).toBe(
        provider,
      );
    }
  });

  test('inferProviderFromUrl: openai / anthropic / google / unknown', () => {
    const cases: Array<[string, string | undefined]> = [
      ['https://api.openai.com/v1/chat/completions', 'openai'],
      ['https://api.anthropic.com/v1/messages', 'anthropic'],
      ['https://generativelanguage.googleapis.com/v1beta/models/x', 'google'],
      ['https://example.com/llm', undefined],
    ];
    for (const [providerUrl, provider] of cases) {
      expect(
        attrs(buildLLMCompletionSpan({ content: 'x', model: 'mysterymodel', providerUrl }))[
          'openbox.model.provider'
        ],
      ).toBe(provider);
    }
  });
});

describe('buildLLMCompletionSpan timestamps, duration, status, usage', () => {
  test('no timestamps → derives duration via deriveDurationNs fallback', () => {
    const span = buildLLMCompletionSpan({ content: 'x' });
    expect(typeof span.duration_ns).toBe('number');
    expect(span.duration_ns).toBeGreaterThanOrEqual(0);
  });

  test('millisecond timestamps are normalized to nanoseconds', () => {
    const span = buildLLMCompletionSpan({ content: 'x', startTime: 1_700_000_000_000, endTime: 1_700_000_000_500 });
    expect(span.duration_ns).toBe(500 * 1_000_000);
  });

  test('nanosecond-scale timestamps are kept as-is', () => {
    const span = buildLLMCompletionSpan({
      content: 'x',
      startTime: 200_000_000_000_000,
      endTime: 200_000_000_000_500,
    });
    expect(span.duration_ns).toBe(500);
  });

  test('explicit durationNs wins; source duration used when > 0', () => {
    expect(buildLLMCompletionSpan({ content: 'x', durationNs: 4242 }).duration_ns).toBe(4242);
    const src = buildLLMCompletionSpan({ content: 'x', span: { duration_ns: 9000 } as never });
    expect(src.duration_ns).toBe(9000);
  });

  test('source timestamps + explicit attributes http.url provider inference', () => {
    const span = buildLLMCompletionSpan({
      content: 'x',
      model: 'mysterymodel',
      span: {
        start_time: 1_700_000_000_000,
        end_time: 1_700_000_000_100,
        attributes: { 'http.url': 'https://api.anthropic.com/v1/messages' },
      } as never,
    });
    expect(attrs(span)['openbox.model.provider']).toBe('anthropic');
  });

  test('status: error description, unset, and pre-set status object', () => {
    const withError = buildLLMCompletionSpan({ content: 'x', span: { error: 'kaboom' } as never });
    expect(asRecord(withError.status).code).toBe('ERROR');
    expect(asRecord(withError.status).description).toBe('kaboom');
    expect(withError.error).toBe('kaboom');

    const noError = buildLLMCompletionSpan({ content: 'x' });
    expect(asRecord(noError.status).code).toBe('UNSET');

    const preset = buildLLMCompletionSpan({ content: 'x', span: { status: { code: 'OK' } } as never });
    expect(asRecord(preset.status).code).toBe('OK');
  });

  test('string usage values + cost are coerced; empty strings ignored', () => {
    const span = buildLLMCompletionSpan({
      content: 'x',
      model: 'gpt-4',
      usage: {
        input_tokens: '5',
        output_tokens: '6',
        total_tokens: '11',
        cache_read_input_tokens: '1',
        cache_creation_input_tokens: '2',
        web_search_requests: '3',
        cost_usd: '0.5',
      } as never,
    });
    const a = attrs(span);
    expect(a['gen_ai.usage.input_tokens']).toBe(5);
    expect(a['gen_ai.usage.output_tokens']).toBe(6);
    expect(a['gen_ai.usage.total_tokens']).toBe(11);
    expect(a['gen_ai.usage.cache_read_input_tokens']).toBe(1);
    expect(a['gen_ai.usage.cache_creation_input_tokens']).toBe(2);
    expect(a['gen_ai.usage.web_search_requests']).toBe(3);
    expect(a['openbox.usage.cost_usd']).toBe(0.5);

    const empty = buildLLMCompletionSpan({
      content: 'x',
      usage: { input_tokens: '', cost_usd: '' } as never,
    });
    expect(attrs(empty)['gen_ai.usage.input_tokens']).toBeUndefined();
  });

  test('derived total tokens from prompt/completion; cost-only usage has no total', () => {
    const promptOnly = JSON.parse(
      buildLLMCompletionSpan({ content: 'x', usage: { input_tokens: 3 } }).response_body as string,
    );
    expect(promptOnly.usage.total_tokens).toBe(3);
    const both = JSON.parse(
      buildLLMCompletionSpan({ content: 'x', usage: { input_tokens: 3, output_tokens: 4 } })
        .response_body as string,
    );
    expect(both.usage.total_tokens).toBe(7);
    const completionOnly = JSON.parse(
      buildLLMCompletionSpan({ content: 'x', usage: { output_tokens: 4 } }).response_body as string,
    );
    expect(completionOnly.usage.total_tokens).toBe(4); // derived from 0 + 4
    const costOnly = buildLLMCompletionSpan({ content: 'x', usage: { cost_usd: 0.9 } });
    expect(attrs(costOnly)['gen_ai.usage.total_tokens']).toBeUndefined();
    expect(attrs(costOnly)['openbox.usage.cost_usd']).toBe(0.9);
  });

  test('coerceHttpStatusCode handles string, empty, and non-numeric', () => {
    expect(buildLLMCompletionSpan({ content: 'x', httpStatusCode: '200' }).http_status_code).toBe(200);
    expect(buildLLMCompletionSpan({ content: 'x', httpStatusCode: '' }).http_status_code).toBeUndefined();
    expect(buildLLMCompletionSpan({ content: 'x', httpStatusCode: 'abc' }).http_status_code).toBeUndefined();
  });

  test('default response headers when status present but no headers provided', () => {
    const withStatus = buildLLMCompletionSpan({ content: 'x', provider: 'openai', httpStatusCode: 200 });
    expect((withStatus.response_headers as Record<string, string>)['openai-version']).toBe('2020-10-01');
    const noStatus = buildLLMCompletionSpan({ content: 'x' });
    expect(noStatus.response_headers).toBeUndefined();
  });

  test('empty request_headers object falls back to default LLM request headers', () => {
    const span = buildLLMCompletionSpan({ content: 'x', provider: 'anthropic', requestHeaders: {} });
    const h = span.request_headers as Record<string, string>;
    expect(h['x-api-key']).toBe('[REDACTED]');
    expect(h['anthropic-version']).toBe('2023-06-01');
  });

  test('raw request/response bodies are used verbatim; function raw body → undefined', () => {
    const verbatim = buildLLMCompletionSpan({
      content: 'x',
      rawRequestBody: { raw: true },
      rawResponseBody: 'RAW-RESP',
    });
    expect(verbatim.request_body).toBe(JSON.stringify({ raw: true }));
    expect(verbatim.response_body).toBe('RAW-RESP');
  });

  test('sanitizeHeaderMap drops non-string values and redacts sensitive headers', () => {
    const span = buildLLMCompletionSpan({
      content: 'x',
      responseHeaders: {
        'x-numeric': 123 as unknown as string,
        authorization: 'Bearer secret',
        'x-ratelimit-remaining-tokens': '42',
      },
      httpStatusCode: 200,
    });
    const headers = span.response_headers as Record<string, string>;
    expect(headers['x-numeric']).toBeUndefined();
    expect(headers.authorization).toBe('[REDACTED]');
    expect(headers['x-ratelimit-remaining-tokens']).toBe('42');
  });
});

describe('leanCopilotLlmSpan', () => {
  test('non-POST span is returned unchanged', () => {
    const span = { name: 'GET', data: { keep: true } };
    expect(leanCopilotLlmSpan(span)).toBe(span);
  });

  test('POST span: null duration/description dropped, attrs minimal', () => {
    const lean = leanCopilotLlmSpan({
      name: 'POST',
      data: { x: 1 },
      span_type: 'function',
      model: 'gpt-4',
      duration_ns: null,
      status: { code: 'UNSET', description: null },
    }) as Record<string, unknown>;
    expect(lean.data).toBeUndefined();
    expect(lean.model).toBeUndefined();
    expect(lean.duration_ns).toBeUndefined();
    expect(lean.semantic_type).toBeDefined();
    expect(Object.keys(lean.attributes as object)).toHaveLength(0);
    expect((lean.status as Record<string, unknown>).description).toBeUndefined();
  });

  test('POST span: numeric duration + http fields kept; non-null description kept', () => {
    const lean = leanCopilotLlmSpan({
      name: 'POST',
      http_url: 'https://api.openai.com/v1/chat/completions',
      http_method: 'POST',
      http_status_code: 200,
      duration_ns: 1000,
      status: { code: 'OK', description: 'fine' },
    }) as Record<string, unknown>;
    expect(lean.duration_ns).toBe(1000);
    const a = lean.attributes as Record<string, unknown>;
    expect(a['http.url']).toBe('https://api.openai.com/v1/chat/completions');
    expect(a['http.method']).toBe('POST');
    expect(a['http.status_code']).toBe(200);
    expect((lean.status as Record<string, unknown>).description).toBe('fine');
  });

  test('POST span without http fields / status', () => {
    const lean = leanCopilotLlmSpan({ name: 'POST' }) as Record<string, unknown>;
    expect(Object.keys(lean.attributes as object)).toHaveLength(0);
    expect(lean.status).toBeUndefined();
  });
});

describe('buildSpan: llm', () => {
  test('completed LLM span carries usage, status code, response body', () => {
    const span = buildSpan('claude-code', 'llm', {
      model: 'anthropic/claude-3',
      prompt: 'hi',
      response: 'hello there',
      usage: { input_tokens: 3, output_tokens: 5, total_tokens: 8, cost_usd: 0.02 },
    });
    expect(span.stage).toBe('completed');
    expect(span.http_status_code).toBe(200);
    const body = JSON.parse(span.response_body as string);
    expect(body.choices[0].message.content).toBe('hello there');
    expect(attrs(span)['openbox.model.provider']).toBe('anthropic');
  });

  test('started LLM span: no response body, request body present', () => {
    const span = buildSpan('cursor', 'llm', { model: 'gpt-4', prompt: 'hi' });
    expect(span.stage).toBe('started');
    expect(span.response_body).toBeUndefined();
    expect(span.request_body).toBeDefined();
  });

  test('explicit request URL preferred; raw bodies used verbatim', () => {
    const span = buildSpan('cursor', 'llm', {
      model: 'gpt-4',
      url: 'https://proxy.internal/llm',
      rawRequestBody: { raw: 1 },
      rawResponseBody: 'RAW',
      stage: 'completed',
    });
    expect(span.http_url).toBe('https://proxy.internal/llm');
    expect(span.request_body).toBe(JSON.stringify({ raw: 1 }));
    expect(span.response_body).toBe('RAW');
  });

  test('function raw request body serializes to undefined → request_body omitted', () => {
    const span = buildSpan('cursor', 'llm', {
      stage: 'started',
      rawRequestBody: function raw() {},
    });
    expect(span.request_body).toBeUndefined();
  });

  test('empty request_headers object falls back to defaults; explicit status code string', () => {
    const span = buildSpan('cursor', 'llm', {
      model: 'gpt-4',
      stage: 'completed',
      request_headers: {},
      http_status_code: '418',
      response_headers: { 'content-type': 'application/json' },
    });
    expect((span.request_headers as Record<string, string>).authorization).toBe('[REDACTED]');
    expect(span.http_status_code).toBe(418);
  });

  test('provided requestBody/responseBody objects are merged', () => {
    const span = buildSpan('cursor', 'llm', {
      model: 'gpt-4',
      stage: 'completed',
      response: 'resp',
      requestBody: { messages: [{ role: 'user', content: 'q' }] },
      responseBody: { id: 'r1' },
    });
    expect(JSON.parse(span.request_body as string).messages[0].content).toBe('q');
    expect(JSON.parse(span.response_body as string).id).toBe('r1');
  });
});

describe('buildSpan: llm_embedding', () => {
  test('embedding span with model, prompt, usage', () => {
    const span = buildSpan('cursor', 'llm_embedding', {
      model: 'openai/text-embedding-3-small',
      prompt: 'embed me',
      usage: { input_tokens: 4, cost_usd: 0.001 },
    });
    expect(span.name).toBe('openai.EMBEDDING.create');
    expect(span.http_url).toContain('/embeddings');
    expect(attrs(span)['gen_ai.usage.input_tokens']).toBe(4);
    expect(attrs(span)['gen_ai.usage.total_tokens']).toBe(4); // falls back to inputTokens
    expect(attrs(span)['openbox.usage.cost_usd']).toBe(0.001);
    expect(JSON.parse(span.request_body as string).input).toBe('embed me');
    expect(span.response_body).toBeNull();
  });

  test('minimal embedding span (no model/usage/prompt)', () => {
    const span = buildSpan('cursor', 'llm_embedding', {});
    expect(span.kind).toBe('INTERNAL');
    expect(attrs(span)['gen_ai.request.model']).toBeUndefined();
    expect(JSON.parse(span.request_body as string)).toEqual({});
  });
});

describe('buildSpan: llm_tool_call', () => {
  test('completed (default) with no tool_output → tool_calls response body', () => {
    const span = buildSpan('cursor', 'llm_tool_call', {
      model: 'gpt-4',
      tool_name: 'search',
      tool_input: { q: 'x' },
      usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3, cost_usd: 0.1 },
    });
    expect(span.name).toBe('openai.TOOL.call');
    expect(span.function).toBe('ToolCall:search');
    const body = JSON.parse(span.response_body as string);
    expect(body.tool_calls[0].name).toBe('search');
    expect(attrs(span)['tool.name']).toBe('search');
  });

  test('completed with tool_output → tool_output response body', () => {
    const span = buildSpan('cursor', 'llm_tool_call', {
      tool: 'calc',
      tool_output: { result: 42 },
      stage: 'completed',
    });
    expect(JSON.parse(span.response_body as string).tool_output.result).toBe(42);
    expect(span.function).toBe('ToolCall:calc');
  });

  test('started tool call → no response body', () => {
    const span = buildSpan('cursor', 'llm_tool_call', { stage: 'started', tool_name: 'noop' });
    expect(span.response_body).toBeUndefined();
  });

  test('default tool name + no tool_input → tool_calls with empty arguments', () => {
    const span = buildSpan('cursor', 'llm_tool_call', {});
    expect(span.function).toBe('ToolCall:tool_call');
    const body = JSON.parse(span.response_body as string);
    expect(body.tool_calls[0].name).toBe('tool_call');
    expect(body.tool_calls[0].arguments).toEqual({});
  });
});

describe('buildSpan: file operations', () => {
  test('file_read with bytes + tool name, and minimal', () => {
    const withBytes = buildSpan('cursor', 'file_read', {
      file_path: '/a.txt',
      bytes_read: 100,
      tool_name: 'Read',
      data: { extra: 1 },
    });
    expect(attrs(withBytes)['file.bytes']).toBe(100);
    expect(attrs(withBytes)['tool.name']).toBe('Read');
    expect(withBytes.kind).toBe('INTERNAL');
    expect(withBytes.data).toEqual({ extra: 1 }); // buildSpan data merge
    const minimal = buildSpan('cursor', 'file_read', {});
    expect(attrs(minimal)['file.bytes']).toBeUndefined();
    expect(minimal.file_path).toBe('');
  });

  test('file_open with byte totals + mode, and minimal', () => {
    const span = buildSpan('cursor', 'file_open', {
      file_path: '/a',
      bytes_read: 1,
      bytes_written: 2,
      file_mode: 'rw',
      tool: 'Open',
    });
    expect(attrs(span)['file.total_bytes_read']).toBe(1);
    expect(attrs(span)['file.total_bytes_written']).toBe(2);
    expect(attrs(span)['file.mode']).toBe('rw');
    const minimal = buildSpan('cursor', 'file_open', { file_path: '/b' });
    expect(attrs(minimal)['file.total_bytes_read']).toBeUndefined();
    expect(attrs(minimal)['file.mode']).toBe('r');
    // No file_path → empty-string fallback; only bytes_written → bytes_read ?? 0.
    const writeOnly = buildSpan('cursor', 'file_open', { bytes_written: 5 });
    expect(writeOnly.file_path).toBe('');
    expect(attrs(writeOnly)['file.path']).toBe('');
    expect(attrs(writeOnly)['file.total_bytes_read']).toBe(0);
    expect(attrs(writeOnly)['file.total_bytes_written']).toBe(5);
    // Only bytes_read → bytes_written ?? 0.
    const readOnly = buildSpan('cursor', 'file_open', { file_path: '/c', bytes_read: 7 });
    expect(attrs(readOnly)['file.total_bytes_read']).toBe(7);
    expect(attrs(readOnly)['file.total_bytes_written']).toBe(0);
  });

  test('file_write with bytes, and minimal', () => {
    const span = buildSpan('cursor', 'file_write', { file_path: '/a', bytes_written: 50 });
    expect(attrs(span)['file.bytes']).toBe(50);
    expect(span.file_mode).toBe('w');
    const minimal = buildSpan('cursor', 'file_write', {});
    expect(attrs(minimal)['file.bytes']).toBeUndefined();
  });

  test('file_delete with and without tool name', () => {
    const span = buildSpan('cursor', 'file_delete', { file_path: '/a', tool_name: 'rm' });
    expect(attrs(span)['file.operation']).toBe('delete');
    expect(attrs(span)['tool.name']).toBe('rm');
    const minimal = buildSpan('cursor', 'file_delete', {});
    expect(attrs(minimal)['tool.name']).toBeUndefined();
  });
});

describe('buildSpan: shell', () => {
  test('shell with tool name and without', () => {
    const span = buildSpan('cursor', 'shell', { command: 'ls', cwd: '/tmp', tool_name: 'Bash' });
    expect(attrs(span)['shell.command']).toBe('ls');
    expect(attrs(span)['tool.name']).toBe('Bash');
    const minimal = buildSpan('cursor', 'shell', {});
    expect(attrs(minimal)['shell.command']).toBe('');
    expect(attrs(minimal)['tool.name']).toBeUndefined();
  });
});

describe('buildSpan: mcp', () => {
  test('claude-style mcp__server__op tool name is parsed', () => {
    const span = buildSpan('cursor', 'mcp', {
      tool_name: 'mcp__github__create_issue',
      tool_input: { title: 'x' },
      mcp_method: 'callTool',
      tool_output: { ok: true },
    });
    expect(attrs(span)['mcp.server_id']).toBe('github');
    expect(attrs(span)['mcp.operation']).toBe('create_issue');
    expect(attrs(span)['mcp.method']).toBe('callTool');
    expect(span.result).toEqual({ ok: true });
  });

  test('minimal mcp span uses defaults', () => {
    const span = buildSpan('cursor', 'mcp', {});
    expect(attrs(span)['mcp.method']).toBe('callTool');
    expect(attrs(span)['mcp.operation']).toBe('call');
    expect(attrs(span)['mcp.server_id']).toBe('unknown');
  });

  test('mcp with explicit server + non-mcp tool name', () => {
    const span = buildSpan('cursor', 'mcp', {
      tool: 'plain_tool',
      server: 'myserver',
      mcp_operation: 'doThing',
    });
    expect(attrs(span)['mcp.server_id']).toBe('myserver');
    expect(attrs(span)['mcp.operation']).toBe('doThing');
  });

  test('empty-string tool name → operation falls back to "call"', () => {
    const span = buildSpan('cursor', 'mcp', { tool_name: '' });
    expect(attrs(span)['mcp.operation']).toBe('call');
  });
});

describe('buildSpan: http', () => {
  test('full http span with bodies and headers', () => {
    const span = buildSpan('cursor', 'http', {
      method: 'post',
      url: 'https://x.com/api',
      request_body: { a: 1 },
      response_body: 'plain-text-response',
      request_headers: { authorization: 'Bearer s', 'content-type': 'application/json' },
      response_headers: { 'set-cookie': 'sid=1' },
      http_status_code: 201,
      tool_name: 'fetch',
    });
    expect(span.name).toBe('POST https://x.com/api');
    expect(span.request_body).toBe(JSON.stringify({ a: 1 }));
    expect(span.response_body).toBe('plain-text-response');
    expect((span.request_headers as Record<string, string>).authorization).toBe('[REDACTED]');
    expect((span.response_headers as Record<string, string>)['set-cookie']).toBe('[REDACTED]');
    expect(span.http_status_code).toBe(201);
  });

  test('minimal http span: GET default, null bodies/headers', () => {
    const span = buildSpan('cursor', 'http', {});
    expect(span.name).toBe('GET ');
    expect(span.request_body).toBeNull();
    expect(span.response_body).toBeNull();
    expect(span.request_headers).toBeNull();
    expect(span.response_headers).toBeNull();
    expect(span.http_status_code).toBeNull();
  });

  test('http body fallbacks: tool_input/data/tool_output', () => {
    const span = buildSpan('cursor', 'http', {
      url: 'https://y',
      tool_input: { q: 1 },
      tool_output: { r: 2 },
    });
    expect(JSON.parse(span.request_body as string).q).toBe(1);
    expect(JSON.parse(span.response_body as string).r).toBe(2);

    const dataSpan = buildSpan('cursor', 'http', { url: 'https://z', data: { d: 1 } });
    expect(JSON.parse(dataSpan.request_body as string).d).toBe(1);
  });

  test('http span with empty header objects → null', () => {
    const span = buildSpan('cursor', 'http', {
      url: 'https://h',
      request_headers: { 'x-num': 5 },
      response_headers: {},
    });
    expect(span.request_headers).toBeNull();
    expect(span.response_headers).toBeNull();
  });
});

describe('buildSpan: db', () => {
  test('explicit system/operation/statement and connection metadata', () => {
    const span = buildSpan('cursor', 'db', {
      db_system: 'mysql',
      db_operation: 'insert',
      db_statement: 'INSERT INTO t VALUES (1)',
      db_name: 'mydb',
      server_address: 'dbhost',
      server_port: 3306,
    } as never);
    expect(attrs(span)['db.system']).toBe('mysql');
    expect(attrs(span)['db.operation']).toBe('INSERT');
    expect(span.db_name).toBe('mydb');
    expect(span.server_address).toBe('dbhost');
    expect(span.server_port).toBe(3306);
  });

  test('alias fields system/operation/query', () => {
    const span = buildSpan('cursor', 'db', {
      system: 'sqlite',
      operation: 'update',
      query: 'UPDATE t SET x=1',
    });
    expect(attrs(span)['db.system']).toBe('sqlite');
    expect(attrs(span)['db.operation']).toBe('UPDATE');
    expect(attrs(span)['db.statement']).toBe('UPDATE t SET x=1');
    expect(span.db_name).toBeNull();
    expect(span.server_address).toBeNull();
    expect(span.server_port).toBeNull();
  });

  test('statement field directly', () => {
    const span = buildSpan('cursor', 'db', { statement: 'SELECT 1' });
    expect(attrs(span)['db.statement']).toBe('SELECT 1');
  });

  test('resource fallback statement', () => {
    const span = buildSpan('cursor', 'db', { resource: 'users' } as never);
    expect(attrs(span)['db.statement']).toBe('database resource users');
  });

  test('table fallback statement', () => {
    const span = buildSpan('cursor', 'db', { table: 'orders' } as never);
    expect(attrs(span)['db.statement']).toBe('database resource orders');
  });

  test('operation fallback statement and defaults', () => {
    const span = buildSpan('cursor', 'db', {});
    expect(attrs(span)['db.system']).toBe('postgresql');
    expect(attrs(span)['db.operation']).toBe('SELECT');
    expect(attrs(span)['db.statement']).toBe('SELECT operation');
  });
});
