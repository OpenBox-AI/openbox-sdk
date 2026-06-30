import { describe, expect, test } from 'vitest';
import {
  buildLLMCompletionResponseBody,
  buildSpan,
  canonicalizeSpan,
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

// Parse a canonical http_request LLM span's synthesized request/response bodies,
// which still carry the model/provider/usage telemetry that canonicalizeSpan
// strips from the span root + attributes.
const reqBody = (span: Record<string, unknown>): Record<string, unknown> =>
  JSON.parse(String(span.request_body));
const respBody = (span: Record<string, unknown>): Record<string, unknown> =>
  JSON.parse(String(span.response_body));

// These tests drive the remaining uncovered helper + span-type branches in
// ts/src/governance/spans.ts purely through the module's exported API.

const attrs = (span: unknown): Record<string, unknown> =>
  (span as Record<string, unknown>).attributes as Record<string, unknown>;

const asRecord = (value: unknown): Record<string, unknown> =>
  value as unknown as Record<string, unknown>;

describe('errorDescription (via buildSpan error)', () => {
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

describe('provider normalization & inference (via canonical buildSpan llm)', () => {
  // The canonical http_request span strips the gen_ai.*/openbox.* telemetry, so
  // provider/model inference is asserted through the synthesized request_body
  // (model_id/provider/model_provider) and the derived http_url.

  test('provider parsed from "provider/model" identifier: openai / anthropic / google(+gemini) / passthrough', () => {
    const openai = buildSpan('cursor', 'llm', { model: 'openai/gpt-4', prompt: 'hi' });
    expect(reqBody(openai).provider).toBe('openai');
    expect(reqBody(openai).model_id).toBe('gpt-4');

    const anthropic = buildSpan('cursor', 'llm', { model: 'anthropic/claude-3', prompt: 'hi' });
    expect(reqBody(anthropic).provider).toBe('anthropic');
    expect(reqBody(anthropic).model_id).toBe('claude-3');
    expect(anthropic.http_url).toBe('https://api.anthropic.com/v1/messages');

    const google = buildSpan('cursor', 'llm', { model: 'google/some-model', prompt: 'hi' });
    expect(reqBody(google).provider).toBe('google');

    // normalizeProvider maps any "gemini" substring to google.
    const gemini = buildSpan('cursor', 'llm', { model: 'gemini/flash', prompt: 'hi' });
    expect(reqBody(gemini).provider).toBe('google');

    // Unknown provider segment passes through verbatim (lowercased).
    const mistral = buildSpan('cursor', 'llm', { model: 'mistral/large', prompt: 'hi' });
    expect(reqBody(mistral).provider).toBe('mistral');
  });

  test('slash identifier with empty provider segment falls through to full model id', () => {
    // Leading-slash model: the provider segment is empty, so parseModelIdentifier
    // does not split it into provider/model (exercises the no-split else path).
    const span = buildSpan('cursor', 'llm', { model: '/gpt-4', prompt: 'hi' });
    expect(reqBody(span).model_id).toBe('/gpt-4');
    expect(reqBody(span).provider).toBeUndefined();
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
      expect(reqBody(buildSpan('cursor', 'llm', { model, prompt: 'hi' })).provider).toBe(provider);
    }
  });

  test('inferProviderFromUrl: openai / anthropic / google / unknown', () => {
    const cases: Array<[string, string | undefined]> = [
      ['https://api.openai.com/v1/chat/completions', 'openai'],
      ['https://api.anthropic.com/v1/messages', 'anthropic'],
      ['https://generativelanguage.googleapis.com/v1beta/models/x', 'google'],
      ['https://example.com/llm', undefined],
    ];
    for (const [url, provider] of cases) {
      // An unknown model forces provider inference to fall through to the URL.
      const span = buildSpan('cursor', 'llm', { model: 'mysterymodel', prompt: 'hi', url });
      expect(reqBody(span).provider).toBe(provider);
      // The captured request URL is preferred verbatim as http_url.
      expect(span.http_url).toBe(url);
    }
  });
});

describe('LLM telemetry helpers via canonical buildSpan llm', () => {
  // canonicalizeSpan strips the gen_ai.*/openbox.* usage/model telemetry from the
  // span, but the 'llm' case still COMPUTES it (normalizeUsage, coerceHttpStatusCode,
  // sanitizeHeaderMap, default header builders, response-body synthesis) before the
  // projection. These tests drive those code paths and assert the surviving canonical
  // output (synthesized request/response bodies + OTel headers/status).

  test('applyExplicitTiming: millisecond timestamps normalized to nanoseconds, duration derived', () => {
    const span = buildSpan('cursor', 'llm', {
      stage: 'completed',
      response: 'r',
      startTime: 1_700_000_000_000,
      endTime: 1_700_000_000_500,
    });
    expect(span.start_time).toBe(1_700_000_000_000_000_000);
    expect(span.end_time).toBe(1_700_000_000_500_000_000);
    expect(span.duration_ns).toBe(500 * 1_000_000);
  });

  test('applyExplicitTiming: nanosecond-scale timestamps kept as-is', () => {
    const span = buildSpan('cursor', 'llm', {
      stage: 'completed',
      response: 'r',
      startTime: 200_000_000_000_000,
      endTime: 200_000_000_000_500,
    });
    expect(span.start_time).toBe(200_000_000_000_000);
    expect(span.duration_ns).toBe(500);
  });

  test('applyExplicitTiming: explicit durationNs wins over derived', () => {
    const span = buildSpan('cursor', 'llm', {
      stage: 'completed',
      response: 'r',
      startTime: 1_700_000_000_000,
      endTime: 1_700_000_000_500,
      durationNs: 4242,
    });
    expect(span.duration_ns).toBe(4242);
  });

  test('applyExplicitTiming: started span gets only start_time (no end/duration)', () => {
    const span = buildSpan('cursor', 'llm', {
      stage: 'started',
      prompt: 'hi',
      startTime: 1_700_000_000_000,
      endTime: 1_700_000_000_500,
      durationNs: 999,
    });
    expect(span.start_time).toBe(1_700_000_000_000_000_000);
    // Only completed spans carry end_time/duration_ns.
    expect(span.end_time).toBeNull();
    expect(span.duration_ns).toBeNull();
  });

  test('applyExplicitTiming: durationNs alone is clamped at zero', () => {
    const span = buildSpan('cursor', 'llm', {
      stage: 'completed',
      response: 'r',
      durationNs: -50,
    });
    expect(span.duration_ns).toBe(0);
  });

  test('string usage values + cost are coerced; empty strings ignored', () => {
    const usage = respBody(
      buildSpan('cursor', 'llm', {
        model: 'gpt-4',
        response: 'r',
        stage: 'completed',
        usage: {
          input_tokens: '5',
          output_tokens: '6',
          total_tokens: '11',
          cache_read_input_tokens: '1',
          cache_creation_input_tokens: '2',
          web_search_requests: '3',
          cost_usd: '0.5',
        } as never,
      }),
    ).usage as Record<string, unknown>;
    expect(usage).toMatchObject({
      input_tokens: 5,
      output_tokens: 6,
      total_tokens: 11,
      cache_read_input_tokens: 1,
      cache_creation_input_tokens: 2,
      web_search_requests: 3,
      cost_usd: 0.5,
    });

    // All-empty usage → no usage object synthesized at all.
    const empty = buildSpan('cursor', 'llm', {
      model: 'gpt-4',
      response: 'r',
      stage: 'completed',
      usage: { input_tokens: '', cost_usd: '' } as never,
    });
    expect(respBody(empty).usage).toBeUndefined();
  });

  test('derived total tokens from prompt/completion; cost-only usage has no total', () => {
    const promptOnly = respBody(
      buildSpan('cursor', 'llm', { response: 'r', stage: 'completed', usage: { input_tokens: 3 } }),
    ).usage as Record<string, unknown>;
    expect(promptOnly.total_tokens).toBe(3);

    const both = respBody(
      buildSpan('cursor', 'llm', {
        response: 'r',
        stage: 'completed',
        usage: { input_tokens: 3, output_tokens: 4 },
      }),
    ).usage as Record<string, unknown>;
    expect(both.total_tokens).toBe(7);

    const completionOnly = respBody(
      buildSpan('cursor', 'llm', { response: 'r', stage: 'completed', usage: { output_tokens: 4 } }),
    ).usage as Record<string, unknown>;
    expect(completionOnly.total_tokens).toBe(4); // derived from 0 + 4

    const costOnly = respBody(
      buildSpan('cursor', 'llm', { response: 'r', stage: 'completed', usage: { cost_usd: 0.9 } }),
    ).usage as Record<string, unknown>;
    expect(costOnly.cost_usd).toBe(0.9);
    expect(costOnly.total_tokens).toBeUndefined();
  });

  test('coerceHttpStatusCode handles string, empty, and non-numeric', () => {
    expect(
      buildSpan('cursor', 'llm', { model: 'gpt-4', stage: 'completed', http_status_code: '418' })
        .http_status_code,
    ).toBe(418);
    // Empty / non-numeric coerce to undefined → the canonical span omits the field
    // even on a completed span.
    expect(
      buildSpan('cursor', 'llm', { model: 'gpt-4', stage: 'completed', http_status_code: '' })
        .http_status_code,
    ).toBeUndefined();
    expect(
      buildSpan('cursor', 'llm', { model: 'gpt-4', stage: 'completed', http_status_code: 'abc' })
        .http_status_code,
    ).toBeUndefined();
  });

  test('default response headers when status present but no headers provided; none when started', () => {
    const withStatus = buildSpan('cursor', 'llm', {
      model: 'openai/gpt-4',
      stage: 'completed',
    });
    expect((withStatus.response_headers as Record<string, string>)['openai-version']).toBe(
      '2020-10-01',
    );
    // A started span never has a status code → no response headers synthesized.
    const started = buildSpan('cursor', 'llm', { model: 'gpt-4', prompt: 'hi' });
    expect(started.response_headers).toBeUndefined();
  });

  test('empty request_headers object falls back to default LLM request headers (anthropic)', () => {
    const h = buildSpan('cursor', 'llm', {
      model: 'anthropic/claude-3',
      stage: 'completed',
      request_headers: {},
    }).request_headers as Record<string, string>;
    expect(h['x-api-key']).toBe('[REDACTED]');
    expect(h['anthropic-version']).toBe('2023-06-01');
  });

  test('raw request/response bodies are used verbatim; function raw body → undefined', () => {
    const verbatim = buildSpan('cursor', 'llm', {
      stage: 'completed',
      response: 'x',
      rawRequestBody: { raw: true },
      rawResponseBody: 'RAW-RESP',
    });
    expect(verbatim.request_body).toBe(JSON.stringify({ raw: true }));
    expect(verbatim.response_body).toBe('RAW-RESP');

    // A function raw request body stringifies to undefined → request_body omitted.
    const omitted = buildSpan('cursor', 'llm', {
      stage: 'started',
      rawRequestBody: function raw() {},
    });
    expect(omitted.request_body).toBeUndefined();
  });

  test('canonicalizeSpan caps http_request request/response bodies at 8192 chars', () => {
    // Parity: canonical _build_http_span_data always truncates bodies to 8192;
    // the captured-LLM path serialized raw bodies uncapped before this chokepoint.
    const big = 'x'.repeat(9000);
    const capped = canonicalizeSpan({
      hook_type: 'http_request',
      request_body: big,
      response_body: big,
    });
    const expected = 'x'.repeat(8192) + '...[truncated]';
    expect(capped.request_body).toBe(expected);
    expect(capped.response_body).toBe(expected);
    // At/under the cap is untouched; non-string bodies pass through.
    const small = canonicalizeSpan({
      hook_type: 'http_request',
      request_body: 'short',
      response_body: null,
    });
    expect(small.request_body).toBe('short');
    expect(small.response_body).toBeNull();
  });

  test('buildSpan llm derives error + ERROR status from http_status_code >= 400', () => {
    // Parity: canonical _build_http_span_data sets error="HTTP {status}" + ERROR
    // for any >= 400 response, independent of a caller-supplied error.
    const failed = buildSpan('copilotkit', 'llm', {
      stage: 'completed',
      response: 'x',
      http_status_code: 404,
    });
    expect((failed.status as { code: string }).code).toBe('ERROR');
    expect((failed.status as { description: string }).description).toBe('HTTP 404');
    expect(failed.error).toBe('HTTP 404');

    // < 400 → no derived error (UNSET).
    const ok = buildSpan('copilotkit', 'llm', {
      stage: 'completed',
      response: 'x',
      http_status_code: 200,
    });
    expect((ok.status as { code: string }).code).toBe('UNSET');
    expect(ok.error).toBeNull();
  });

  test('sanitizeHeaderMap drops non-string values and redacts sensitive headers', () => {
    const headers = buildSpan('cursor', 'llm', {
      model: 'gpt-4',
      stage: 'completed',
      response_headers: {
        'x-numeric': 123 as unknown as string,
        authorization: 'Bearer secret',
        'x-ratelimit-remaining-tokens': '42',
      },
    }).response_headers as Record<string, string>;
    expect(headers['x-numeric']).toBeUndefined();
    expect(headers.authorization).toBe('[REDACTED]');
    expect(headers['x-ratelimit-remaining-tokens']).toBe('42');
  });

  test('response_headers with only non-string values → falls back to default response headers', () => {
    // sanitizeHeaderMap returns undefined (no string entries), so with a status code
    // present the default OpenAI response headers are synthesized instead.
    const headers = buildSpan('cursor', 'llm', {
      model: 'openai/gpt-4',
      stage: 'completed',
      response_headers: { 'x-only-number': 7 as unknown as string },
    }).response_headers as Record<string, string>;
    expect(headers['openai-version']).toBe('2020-10-01');
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
    // Provider telemetry survives only in the synthesized bodies (canonical strip).
    expect(reqBody(span).provider).toBe('anthropic');
    expect(span.http_url).toBe('https://api.anthropic.com/v1/messages');
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
  test('embedding span with model, prompt, usage (canonical function_call)', () => {
    const span = buildSpan('cursor', 'llm_embedding', {
      model: 'openai/text-embedding-3-small',
      prompt: 'embed me',
      usage: { input_tokens: 4, cost_usd: 0.001 },
    });
    // Embedding collapses to a canonical function_call span: span_type, the http_*
    // root fields, request/response bodies, and gen_ai.*/openbox.* attrs are stripped.
    expect(span.name).toBe('openai.EMBEDDING.create');
    expect(span.hook_type).toBe('function_call');
    // OTel-native http.* attributes survive (the embeddings endpoint).
    expect(attrs(span)['http.url']).toContain('/embeddings');
    expect(attrs(span)['http.method']).toBe('POST');
    expect(
      Object.keys(attrs(span)).some((k) => k.startsWith('gen_ai.') || k.startsWith('openbox.')),
    ).toBe(false);
    // The request payload survives in the canonical `args` field.
    expect(span.args).toMatchObject({ model: 'openai/text-embedding-3-small', prompt: 'embed me' });
    expect(span.result).toBeNull();
    // Non-canonical fields for a function_call span are dropped.
    expect(span.http_url).toBeUndefined();
    expect(span.request_body).toBeUndefined();
    expect(span.response_body).toBeUndefined();
  });

  test('minimal embedding span (no model/usage/prompt)', () => {
    const span = buildSpan('cursor', 'llm_embedding', {});
    expect(span.kind).toBe('INTERNAL');
    expect(attrs(span)['gen_ai.request.model']).toBeUndefined();
    expect(span.args).toEqual({});
  });
});

describe('buildSpan: llm_tool_call', () => {
  // Tool calls collapse to a canonical function_call span: span_type, http_* root
  // fields, the synthesized request/response bodies, and gen_ai.*/openbox.* attrs are
  // all stripped. The tool input/output survive in the canonical args/result fields.
  test('completed (default) with no tool_output → args from tool_input, null result', () => {
    const span = buildSpan('cursor', 'llm_tool_call', {
      model: 'gpt-4',
      tool_name: 'search',
      tool_input: { q: 'x' },
      usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3, cost_usd: 0.1 },
    });
    expect(span.name).toBe('openai.TOOL.call');
    expect(span.hook_type).toBe('function_call');
    expect(span.function).toBe('ToolCall:search');
    expect(span.args).toEqual({ q: 'x' });
    expect(span.result).toBeNull();
    expect(attrs(span)['tool.name']).toBe('search');
    expect(span.response_body).toBeUndefined();
  });

  test('completed with tool_output → result carries the tool output', () => {
    const span = buildSpan('cursor', 'llm_tool_call', {
      tool: 'calc',
      tool_output: { result: 42 },
      stage: 'completed',
    });
    expect(span.result).toEqual({ result: 42 });
    expect(span.function).toBe('ToolCall:calc');
  });

  test('started tool call → no response body', () => {
    const span = buildSpan('cursor', 'llm_tool_call', { stage: 'started', tool_name: 'noop' });
    expect(span.response_body).toBeUndefined();
  });

  test('default tool name + no tool_input → args fall back to the full input', () => {
    const span = buildSpan('cursor', 'llm_tool_call', {});
    expect(span.function).toBe('ToolCall:tool_call');
    expect(span.args).toEqual({});
    expect(span.result).toBeNull();
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

  test('file_open: mode (explicit + default) + file_path fallback, no total_bytes', () => {
    const span = buildSpan('cursor', 'file_open', {
      file_path: '/a',
      file_mode: 'rw',
      tool: 'Open',
    });
    expect(attrs(span)['file.mode']).toBe('rw');
    // Canonical: cumulative file.total_bytes_* live on the PARENT span, not the
    // file span — so the file_open span no longer carries them.
    expect(attrs(span)['file.total_bytes_read']).toBeUndefined();
    expect(attrs(span)['file.total_bytes_written']).toBeUndefined();
    // Default mode + empty-string file_path fallback.
    const minimal = buildSpan('cursor', 'file_open', { file_path: '/b' });
    expect(attrs(minimal)['file.mode']).toBe('r');
    const noPath = buildSpan('cursor', 'file_open', {});
    expect(noPath.file_path).toBe('');
    expect(attrs(noPath)['file.path']).toBe('');
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
    expect(span.name).toBe('HTTP POST');
    expect(span.request_body).toBe(JSON.stringify({ a: 1 }));
    expect(span.response_body).toBe('plain-text-response');
    expect((span.request_headers as Record<string, string>).authorization).toBe('[REDACTED]');
    expect((span.response_headers as Record<string, string>)['set-cookie']).toBe('[REDACTED]');
    expect(span.http_status_code).toBe(201);
  });

  test('minimal http span: GET default, null bodies/headers', () => {
    const span = buildSpan('cursor', 'http', {});
    expect(span.name).toBe('HTTP GET');
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

describe('canonicalizeSpan (direct branch coverage)', () => {
  test('unknown / missing hook_type → only envelope keys survive, superset root keys dropped', () => {
    const out = canonicalizeSpan({
      hook_type: 'mystery',
      span_id: 's',
      name: 'n',
      attributes: { keep: 1, 'openbox.span_type': 'x', 'gen_ai.system': 'y' },
      // Not in the envelope and no per-hook allow-list for an unknown hook → dropped.
      function: 'f',
      module: 'm',
      span_type: 'function',
    });
    expect(out.span_id).toBe('s');
    expect(out.hook_type).toBe('mystery');
    expect(out.function).toBeUndefined();
    expect(out.module).toBeUndefined();
    expect(out.span_type).toBeUndefined();
    // openbox.*/gen_ai.* attributes filtered, OTel-native attrs kept.
    expect(out.attributes).toEqual({ keep: 1 });

    // A span with no hook_type field at all also resolves to the empty allow-list.
    const noHook = canonicalizeSpan({ name: 'n', http_method: 'GET' });
    expect(noHook.name).toBe('n');
    expect(noHook.http_method).toBeUndefined();
  });

  test('per-hook allow-list keeps canonical root fields (http_request)', () => {
    const out = canonicalizeSpan({
      hook_type: 'http_request',
      http_method: 'POST',
      http_url: 'https://x',
      request_body: 'b',
      attributes: { 'http.method': 'POST' },
      module: 'should-drop',
    });
    expect(out.http_method).toBe('POST');
    expect(out.http_url).toBe('https://x');
    expect(out.request_body).toBe('b');
    expect(out.module).toBeUndefined();
  });

  test('non-object / missing attributes are left untouched', () => {
    const arr = canonicalizeSpan({ hook_type: 'http_request', attributes: ['a', 'b'] });
    expect(arr.attributes).toEqual(['a', 'b']);
    const none = canonicalizeSpan({ hook_type: 'http_request', http_method: 'GET' });
    expect(none.attributes).toBeUndefined();
  });

  test('file.open span drops the file.operation attribute (lives at the root)', () => {
    const out = canonicalizeSpan({
      hook_type: 'file_operation',
      name: 'file.open',
      file_operation: 'open',
      attributes: {
        'file.path': '/x',
        'file.mode': 'r',
        'file.operation': 'open',
        'openbox.span_type': 'file_io',
      },
    });
    expect(out.attributes).toEqual({ 'file.path': '/x', 'file.mode': 'r' });
    expect(out.file_operation).toBe('open');
  });

  test('db_query span name is preserved (no {op} {system} rewrite)', () => {
    // Real dbapi instrumentors (psycopg2/mysql) name the span by operation alone,
    // e.g. "SELECT" — verified against a real Postgres reference span. canonicalizeSpan
    // keeps the db builder's operation name; it does NOT rewrite to "{op} {system}".
    const span = canonicalizeSpan({
      hook_type: 'db_query',
      name: 'SELECT',
      db_operation: 'SELECT',
      db_system: 'postgresql',
    });
    expect(span.name).toBe('SELECT');
  });
});

describe('applyExplicitTiming edge branches (via buildSpan llm)', () => {
  test('completed span with endTime only sets end_time but leaves duration unchanged', () => {
    const span = buildSpan('cursor', 'llm', {
      stage: 'completed',
      response: 'r',
      endTime: 1_700_000_000_500,
    });
    expect(span.end_time).toBe(1_700_000_000_500_000_000);
    // No startTime and no durationNs → derived duration is undefined → base() 0 kept.
    expect(span.duration_ns).toBe(0);
  });

  test('non-finite startTime is ignored while a valid endTime still applies', () => {
    const span = buildSpan('cursor', 'llm', {
      stage: 'completed',
      response: 'r',
      startTime: Number.NaN,
      endTime: 1_700_000_000_500,
    });
    // NaN start is dropped by normalizeSpanTimestamp; end_time still normalized.
    expect(span.end_time).toBe(1_700_000_000_500_000_000);
  });
});
