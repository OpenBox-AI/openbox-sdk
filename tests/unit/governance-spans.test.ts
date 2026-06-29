import { describe, expect, test } from 'vitest';
import type { SpanData } from '../../ts/src/core-client/index.js';
import { assistantOutputTelemetryFields } from '../../ts/src/governance/assistant-output.js';
import { USAGE_NORMALIZATION_SURFACE } from '../../ts/src/governance/capability-matrix.js';
import {
  combineOpenBoxUsage,
  normalizeOpenBoxUsage,
  openBoxUsageTelemetryFields,
} from '../../ts/src/governance/usage.js';
import {
  buildLLMCompletionResponseBody,
  buildSpan,
  llmTokenUsageFromRecord,
  openBoxActivityMetadata,
  withOpenBoxActivityMetadata,
  withOpenBoxSubagentActivityMetadata,
} from '../../ts/src/governance/spans.js';

function extractAssistantContentLikeCore(spans: SpanData[]): string {
  if (spans.length === 0) return '';
  const latest = spans[spans.length - 1];
  if (
    latest.stage !== 'completed' ||
    !latest.response_body
  ) {
    return '';
  }
  const response = JSON.parse(latest.response_body) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = response.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : '';
}

describe('LLM completion spans', () => {
  test('CONFORMANCE: normalizes token, cache, web-search, and cost usage through the shared facade', () => {
    expect(USAGE_NORMALIZATION_SURFACE.minimumValue).toBe(0);
    expect(USAGE_NORMALIZATION_SURFACE.tokenValuesRequireIntegers).toBe(true);
    expect(
      normalizeOpenBoxUsage({
        prompt_tokens: 3,
        completionTokens: 4,
        cache_read_input_tokens: 2,
        webSearchRequests: 1,
        total_cost_usd: 0.012,
      }),
    ).toMatchObject({
      inputTokens: 3,
      outputTokens: 4,
      totalTokens: 7,
      cacheReadInputTokens: 2,
      webSearchRequests: 1,
      costUsd: 0.012,
    });
    expect(
      openBoxUsageTelemetryFields({
        inputTokenCount: 5,
        outputTokenCount: 6,
      }),
    ).toEqual({
      inputTokens: 5,
      outputTokens: 6,
      totalTokens: 11,
      costUsd: undefined,
    });
    expect(USAGE_NORMALIZATION_SURFACE.costUsdAliases).toContain('total_cost_usd');
    expect(
      combineOpenBoxUsage(
        { input_tokens: 1, output_tokens: 2, cost_usd: 0.1 },
        { promptTokens: 3, completionTokens: 4, costUSD: 0.2 },
      ),
    ).toMatchObject({
      inputTokens: 4,
      outputTokens: 6,
      totalTokens: 10,
      costUsd: 0.30000000000000004,
    });
    expect(
      normalizeOpenBoxUsage({
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        web_search_requests: 0,
        cost_usd: 0,
      }),
    ).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      webSearchRequests: 0,
      costUsd: 0,
    });
    expect(normalizeOpenBoxUsage({ input_tokens: -1, cost_usd: -0.01 })).toBeUndefined();
    expect(normalizeOpenBoxUsage({ input_tokens: 1.5 })).toBeUndefined();
    expect(
      combineOpenBoxUsage(
        { input_tokens: 1, output_tokens: 2, total_tokens: 1 },
        { promptTokens: 3, completionTokens: 4 },
      )?.raw,
    ).toMatchObject({
      inputTokens: 4,
      outputTokens: 6,
      totalTokens: 10,
    });
  });

  test('CONFORMANCE: normalizes nested provider usage containers and dotted aliases', () => {
    expect(USAGE_NORMALIZATION_SURFACE.providerUsageContainers).toContain(
      'response_metadata.token_usage',
    );
    expect(USAGE_NORMALIZATION_SURFACE.cacheReadInputTokenAliases).toContain(
      'input_tokens_details.cached_tokens',
    );

    const usage = normalizeOpenBoxUsage({
      response_metadata: {
        token_usage: {
          prompt_tokens: 8,
          completion_tokens: 5,
          input_tokens_details: {
            cached_tokens: 3,
          },
          total_cost_usd: 0.02,
        },
      },
    });

    expect(usage).toMatchObject({
      inputTokens: 8,
      outputTokens: 5,
      totalTokens: 13,
      cacheReadInputTokens: 3,
      costUsd: 0.02,
    });

    const span = buildSpan('mcp', 'llm', {
      response: 'Nested usage works.',
      usage: {
        response_metadata: {
          token_usage: {
            prompt_tokens: 8,
            completion_tokens: 5,
            input_tokens_details: {
              cached_tokens: 3,
            },
            total_cost_usd: 0.02,
          },
        },
      } as any,
    });

    // Canonical http_request span: token/cost telemetry is no longer carried as
    // span-root fields or gen_ai.*/openbox.* attributes. Normalized usage survives
    // only inside the response_body (which Core re-derives it from).
    expect(span.hook_type).toBe('http_request');
    expect(span.http_method).toBe('POST');
    for (const k of ['input_tokens', 'output_tokens', 'total_tokens', 'cache_read_input_tokens', 'cost_usd']) {
      expect(span[k]).toBeUndefined();
    }
    expect(
      Object.keys(span.attributes as Record<string, unknown>).some(
        (key) => key.startsWith('gen_ai.') || key.startsWith('openbox.'),
      ),
    ).toBe(false);
    expect(JSON.parse(String(span.response_body)).usage).toMatchObject({
      input_tokens: 8,
      output_tokens: 5,
      total_tokens: 13,
      cache_read_input_tokens: 3,
      cost_usd: 0.02,
    });
  });

  test('preserves explicit zero usage in completed and generic LLM spans', () => {
    const usage = {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      web_search_requests: 0,
      cost_usd: 0,
    };
    const completed = buildSpan('mcp', 'llm', {
      stage: 'completed',
      response: 'No billable usage.',
      model: 'gpt-4o-mini',
      usage,
    });
    const generic = buildSpan('mcp', 'llm', {
      response: 'No billable usage.',
      model: 'gpt-4o-mini',
      usage,
    });

    // buildSpan emits the canonical http_request shape — zero usage survives only
    // in the response_body, not as span-root fields or gen_ai.*/openbox.* attrs.
    for (const span of [completed, generic]) {
      expect(span.hook_type).toBe('http_request');
      for (const k of ['input_tokens', 'output_tokens', 'total_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'web_search_requests', 'cost_usd']) {
        expect(span[k]).toBeUndefined();
      }
      expect(
        Object.keys(span.attributes as Record<string, unknown>).some(
          (key) => key.startsWith('gen_ai.') || key.startsWith('openbox.'),
        ),
      ).toBe(false);
      expect(JSON.parse(String(span.response_body)).usage).toMatchObject(usage);
    }
  });

  test('response body matches Core goal-alignment assistant extraction', () => {
    expect(
      extractAssistantContentLikeCore([
        {
          span_id: 'span-1',
          trace_id: 'trace-1',
          name: 'openbox.copilotkit.assistant_output',
          start_time: 1,
          end_time: 2,
          stage: 'completed',
          semantic_type: 'llm_completion',
          response_body: buildLLMCompletionResponseBody(
            'The safe summary is ready.',
          ),
        },
      ]),
    ).toBe('The safe summary is ready.');
  });

  test('builds the Core-compatible completed llm_completion span shape', () => {
    const span = buildSpan('copilotkit', 'llm', {
      stage: 'completed',
      response: 'The queue has two governed requests ready.',
    });

    // Canonical: an assistant-output / LLM provider call is a plain http_request
    // span — name 'POST', kind 'CLIENT', OTel-native http.* attributes only.
    expect(span).not.toHaveProperty('semantic_type');
    expect(span.attributes).not.toHaveProperty('openbox.semantic_type');
    expect(span).toMatchObject({
      parent_span_id: null,
      name: 'POST',
      kind: 'CLIENT',
      hook_type: 'http_request',
      stage: 'completed',
      status: { code: 'UNSET', description: null },
      events: [],
      error: null,
      http_method: 'POST',
      http_url: 'https://api.openai.com/v1/chat/completions',
      attributes: {
        'http.method': 'POST',
        'http.url': 'https://api.openai.com/v1/chat/completions',
      },
    });
    expect(
      Object.keys(span.attributes as Record<string, unknown>).some(
        (key) => key.startsWith('gen_ai.') || key.startsWith('openbox.'),
      ),
    ).toBe(false);
    expect(extractAssistantContentLikeCore([span as never])).toBe(
      'The queue has two governed requests ready.',
    );
  });

  test('propagates LLM span error into the canonical status and error root fields', () => {
    const span = buildSpan('mcp', 'llm', {
      response: 'failed',
      error: 'model failed',
    });

    // Canonical envelope carries the error as both the status description and the
    // root `error` field; events default to [] and parent_span_id to null.
    expect(span).toMatchObject({
      parent_span_id: null,
      hook_type: 'http_request',
      status: { code: 'ERROR', description: 'model failed' },
      events: [],
      error: 'model failed',
    });
  });

  test('carries model and usage telemetry only inside the canonical response_body', () => {
    const beforeNs = Date.now() * 1_000_000;
    const span = buildSpan('mcp', 'llm', {
      stage: 'completed',
      response: 'The governed request is ready.',
      model: 'gpt-4o-mini',
      usage: {
        promptTokens: 120,
        completionTokens: 35,
      },
    });
    const afterNs = Date.now() * 1_000_000;

    expect(Number(span.start_time)).toBeGreaterThanOrEqual(beforeNs - 1_000_000);
    expect(Number(span.start_time)).toBeLessThanOrEqual(afterNs + 1_000_000);
    expect(Number(span.end_time)).toBeGreaterThanOrEqual(beforeNs - 1_000_000);
    expect(Number(span.end_time)).toBeLessThanOrEqual(afterNs + 1_000_000);

    // Model/usage telemetry is re-derivable by Core from the verbatim response_body.
    expect(JSON.parse(String(span.response_body))).toEqual({
      choices: [
        {
          message: {
            content: 'The governed request is ready.',
          },
        },
      ],
      model: 'gpt-4o-mini',
      model_id: 'gpt-4o-mini',
      provider: 'openai',
      model_provider: 'openai',
      usage: {
        prompt_tokens: 120,
        input_tokens: 120,
        completion_tokens: 35,
        output_tokens: 35,
        total_tokens: 155,
      },
    });
    expect(span.http_url).toBe('https://api.openai.com/v1/chat/completions');
    expect(span.http_method).toBe('POST');
    expect(span.hook_type).toBe('http_request');
    // Canonical http_request: NO model/token telemetry at the span root.
    for (const k of ['model', 'model_id', 'provider', 'model_provider', 'input_tokens', 'output_tokens', 'total_tokens']) {
      expect(span[k]).toBeUndefined();
    }
    expect(span).not.toHaveProperty('semantic_type');
    expect(span.attributes).not.toHaveProperty('openbox.semantic_type');
    // OTel-native attributes only — no gen_ai.*/openbox.*.
    expect(span.attributes).toMatchObject({
      'http.method': 'POST',
      'http.url': 'https://api.openai.com/v1/chat/completions',
      'http.status_code': 200,
    });
    expect(
      Object.keys(span.attributes as Record<string, unknown>).some(
        (key) => key.startsWith('gen_ai.') || key.startsWith('openbox.'),
      ),
    ).toBe(false);
  });

  test('generic LLM spans expose derived total tokens for backend metrics', () => {
    const span = buildSpan('cursor', 'llm', {
      model: 'gemini-2.5-flash',
      prompt: 'Summarize the changed files.',
      response: 'The changed files update telemetry.',
      usage: {
        input_tokens: 11,
        output_tokens: 7,
      },
    });

    expect(span).not.toHaveProperty('semantic_type');
    expect(span.attributes).not.toHaveProperty('openbox.semantic_type');
    // Canonical http_request span: model/token telemetry no longer rides on the
    // span root or as gen_ai.*/openbox.* attributes — only the OTel-native http.*
    // attributes and the canonical http_method/http_url root fields remain. The
    // derived totals survive in the request/response bodies (asserted below).
    expect(span.hook_type).toBe('http_request');
    expect(span).toMatchObject({
      http_method: 'POST',
      http_url: 'https://generativelanguage.googleapis.com/v1beta/models/generateContent',
      attributes: {
        'http.method': 'POST',
        'http.url': 'https://generativelanguage.googleapis.com/v1beta/models/generateContent',
      },
    });
    for (const k of ['model', 'model_id', 'provider', 'model_provider', 'input_tokens', 'output_tokens', 'total_tokens']) {
      expect(span[k]).toBeUndefined();
    }
    expect(
      Object.keys(span.attributes as Record<string, unknown>).some(
        (key) => key.startsWith('gen_ai.') || key.startsWith('openbox.'),
      ),
    ).toBe(false);

    expect(JSON.parse(span.request_body as string)).toMatchObject({
      model: 'gemini-2.5-flash',
      model_id: 'gemini-2.5-flash',
      provider: 'google',
      model_provider: 'google',
      messages: [{ role: 'user', content: 'Summarize the changed files.' }],
    });
    expect(JSON.parse(span.response_body as string)).toMatchObject({
      model: 'gemini-2.5-flash',
      model_id: 'gemini-2.5-flash',
      provider: 'google',
      model_provider: 'google',
      usage: {
        input_tokens: 11,
        output_tokens: 7,
        total_tokens: 18,
      },
      choices: [
        {
          message: { content: 'The changed files update telemetry.' },
        },
      ],
    });
  });

  test('normalizes Gemini usageMetadata token-count fields', () => {
    const usage = llmTokenUsageFromRecord({
      promptTokenCount: 11,
      candidatesTokenCount: 7,
      totalTokenCount: 21,
    });

    expect(usage).toMatchObject({
      promptTokens: 11,
      completionTokens: 7,
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 21,
    });
    expect(
      assistantOutputTelemetryFields({
        source: 'cursor',
        content: 'Gemini response.',
        model: 'gemini-2.5-flash',
        usage,
      }),
    ).toMatchObject({
      llmModel: 'gemini-2.5-flash',
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 21,
      completion: 'Gemini response.',
    });

    const span = buildSpan('mcp', 'llm', {
      stage: 'completed',
      response: 'Gemini response.',
      model: 'gemini-2.5-flash',
      usage,
    });

    // Canonical http_request span: model/token telemetry survives only in the
    // verbatim response_body, never as span-root fields.
    expect(span.hook_type).toBe('http_request');
    expect(span.http_url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/generateContent',
    );
    for (const k of ['model_id', 'provider', 'input_tokens', 'output_tokens', 'total_tokens']) {
      expect(span[k]).toBeUndefined();
    }
    expect(JSON.parse(String(span.response_body)).usage).toMatchObject({
      input_tokens: 11,
      output_tokens: 7,
      total_tokens: 21,
    });
    expect(JSON.parse(String(span.response_body))).toMatchObject({
      model_id: 'gemini-2.5-flash',
      provider: 'google',
      model_provider: 'google',
    });
    expect(
      llmTokenUsageFromRecord({
        inputTokenCount: 3,
        outputTokenCount: 4,
      }),
    ).toMatchObject({
      inputTokens: 3,
      outputTokens: 4,
    });
  });

  test('assistant output parent telemetry accepts provider snake_case usage', () => {
    expect(
      assistantOutputTelemetryFields({
        source: 'n8n',
        content: 'The workflow completed.',
        model: 'gemini-2.5-flash',
        usage: {
          input_tokens: 11,
          output_tokens: 7,
          total_tokens: 18,
        },
        hasToolCalls: true,
      }),
    ).toMatchObject({
      llmModel: 'gemini-2.5-flash',
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
      hasToolCalls: true,
      completion: 'The workflow completed.',
    });
  });

  test('provider-prefixed model names expose model_id inside the request/response bodies', () => {
    const span = buildSpan('mcp', 'llm', {
      stage: 'completed',
      response: 'done',
      model: 'anthropic/claude-opus-4-8',
      usage: { inputTokens: 2, outputTokens: 3 },
    });

    // Canonical http_request: no model/provider telemetry at the span root.
    for (const k of ['model', 'model_id', 'provider', 'model_provider']) {
      expect(span[k]).toBeUndefined();
    }
    // The provider routes the canonical http.url; the parsed model_id/provider
    // survive only inside the verbatim request/response bodies.
    expect(span.http_url).toBe('https://api.anthropic.com/v1/messages');
    expect(JSON.parse(String(span.request_body))).toMatchObject({
      model: 'anthropic/claude-opus-4-8',
      model_id: 'claude-opus-4-8',
      provider: 'anthropic',
      model_provider: 'anthropic',
    });
    expect(JSON.parse(String(span.response_body))).toMatchObject({
      model: 'anthropic/claude-opus-4-8',
      model_id: 'claude-opus-4-8',
      provider: 'anthropic',
      model_provider: 'anthropic',
    });
    expect(span.attributes).toMatchObject({
      'http.url': 'https://api.anthropic.com/v1/messages',
    });
    expect(
      Object.keys(span.attributes as Record<string, unknown>).some(
        (key) => key.startsWith('gen_ai.') || key.startsWith('openbox.'),
      ),
    ).toBe(false);
  });

  test('normalizes Date.now-style explicit LLM span timestamps to nanoseconds', () => {
    const span = buildSpan('mcp', 'llm', {
      stage: 'completed',
      response: 'done',
      startTime: 1_700_000_000_000,
      endTime: 1_700_000_000_125,
      durationNs: 125_000_000,
    });

    expect(span.start_time).toBe(1_700_000_000_000_000_000);
    expect(span.end_time).toBe(1_700_000_000_125_000_000);
    expect(span.duration_ns).toBe(125_000_000);
  });

  test('derives LLM span duration from explicit start and end timestamps', () => {
    const span = buildSpan('mcp', 'llm', {
      stage: 'completed',
      response: 'done',
      startTime: 1_700_000_000_000,
      endTime: 1_700_000_000_125,
    });

    expect(span.start_time).toBe(1_700_000_000_000_000_000);
    expect(span.end_time).toBe(1_700_000_000_125_000_000);
    // Canonical buildSpan derives duration by subtracting nanosecond timestamps,
    // which exceed Number's safe-integer range, so the 125ms result lands within
    // float rounding rather than exactly 125_000_000.
    expect(Math.abs(Number(span.duration_ns) - 125_000_000)).toBeLessThan(1_000);
  });

  test('default classifier URL does not create a provider alias by itself', () => {
    const span = buildSpan('mcp', 'llm', {
      stage: 'completed',
      response: 'done',
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    // No model/provider hint → falls back to the default OpenAI-compatible URL,
    // and the canonical http_request span exposes no provider telemetry at all.
    expect(span.http_url).toBe('https://api.openai.com/v1/chat/completions');
    expect(span.provider).toBeUndefined();
    expect(span.model_provider).toBeUndefined();
    expect(span.attributes).not.toHaveProperty('openbox.model.provider');
    expect(
      Object.keys(span.attributes as Record<string, unknown>).some(
        (key) => key.startsWith('gen_ai.') || key.startsWith('openbox.'),
      ),
    ).toBe(false);
  });

  test('MCP spans expose Core classifier and platform tool telemetry fields', () => {
    const span = buildSpan('cursor', 'mcp', {
      tool_name: 'read_customer_file',
      tool_input: { path: 'customer.md' },
    });

    expect(span).not.toHaveProperty('semantic_type');
    expect(span.attributes).not.toHaveProperty('openbox.semantic_type');
    // Canonical: MCP collapses to a function_call span (span_type stripped; the
    // openbox.* attributes stripped). OTel-native mcp.* and tool.* attrs survive.
    expect(span.span_type).toBeUndefined();
    expect(span.hook_type).toBe('function_call');
    expect(span.name).toBe('MCP callTool read_customer_file');
    expect(span.attributes).toMatchObject({
      'mcp.method': 'callTool',
      'mcp.operation': 'read_customer_file',
      'mcp.server_id': 'unknown',
      'mcp.input': { path: 'customer.md' },
      'tool.name': 'read_customer_file',
      tool_name: 'read_customer_file',
    });
    expect(span.attributes).not.toHaveProperty('openbox.span_type');
    expect(span.attributes).not.toHaveProperty('openbox.tool.name');
  });

  test('embedding spans expose Core classifier fields without client-forged semantic type', () => {
    const span = buildSpan('mcp', 'llm_embedding', {
      model: 'text-embedding-3-small',
      prompt: 'govern this embedding',
      usage: { input_tokens: 12, total_tokens: 12, cost_usd: 0.001 },
    });

    expect(span).not.toHaveProperty('semantic_type');
    expect(span.attributes).not.toHaveProperty('openbox.semantic_type');
    // Canonical: an embedding collapses to a function_call span — span_type, the
    // http_*/token root fields, and gen_ai.*/openbox.* attrs are all stripped. The
    // request payload survives in the canonical `args` field, OTel http.* in attrs.
    expect(span).toMatchObject({
      name: 'openai.EMBEDDING.create',
      hook_type: 'function_call',
      function: 'Embedding',
      module: 'mcp',
    });
    for (const k of ['span_type', 'http_method', 'http_url', 'input_tokens', 'total_tokens', 'cost_usd']) {
      expect(span[k]).toBeUndefined();
    }
    expect(span.attributes).toMatchObject({
      'http.method': 'POST',
      'http.url': 'https://api.openai.com/v1/embeddings',
    });
    expect(
      Object.keys(span.attributes as Record<string, unknown>).some(
        (key) => key.startsWith('gen_ai.') || key.startsWith('openbox.'),
      ),
    ).toBe(false);
    expect(span.args).toMatchObject({
      model: 'text-embedding-3-small',
      prompt: 'govern this embedding',
    });
  });

  test('LLM tool-call spans expose Core classifier fields and tool telemetry', () => {
    const span = buildSpan('openai-agents-sdk', 'llm_tool_call', {
      model: 'gpt-5.4',
      tool_name: 'lookup_queue',
      tool_input: { queue: 'payments' },
      usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
    });

    expect(span).not.toHaveProperty('semantic_type');
    expect(span.attributes).not.toHaveProperty('openbox.semantic_type');
    // Canonical: a tool call collapses to a function_call span — span_type, the
    // http_*/token root fields, response_body, and gen_ai.*/openbox.* attrs are all
    // stripped. The tool input survives in the canonical `args` field.
    expect(span).toMatchObject({
      name: 'openai.TOOL.call',
      hook_type: 'function_call',
      function: 'ToolCall:lookup_queue',
    });
    for (const k of ['span_type', 'http_method', 'http_url', 'input_tokens', 'output_tokens', 'total_tokens']) {
      expect(span[k]).toBeUndefined();
    }
    expect(span.attributes).toMatchObject({
      'http.method': 'POST',
      'http.url': 'https://api.openai.com/v1/chat/completions',
      'tool.name': 'lookup_queue',
      tool_name: 'lookup_queue',
    });
    expect(span.attributes).not.toHaveProperty('openbox.tool.name');
    expect(
      Object.keys(span.attributes as Record<string, unknown>).some(
        (key) => key.startsWith('gen_ai.') || key.startsWith('openbox.'),
      ),
    ).toBe(false);
    expect(span.args).toMatchObject({ queue: 'payments' });
  });

  test('file_open spans expose Core file.open classifier fields', () => {
    const span = buildSpan('cursor', 'file_open', {
      file_path: '/project/.env',
      tool_name: 'TabRead',
    });

    expect(span).not.toHaveProperty('semantic_type');
    expect(span.attributes).not.toHaveProperty('openbox.semantic_type');
    // Canonical file_operation span: span_type stripped; file_operation lives at
    // the root (not as a file.operation attribute on the open span); openbox.* attrs
    // stripped.
    expect(span).toMatchObject({
      name: 'file.open',
      kind: 'INTERNAL',
      file_path: '/project/.env',
      file_mode: 'r',
      file_operation: 'open',
    });
    expect(span.span_type).toBeUndefined();
    expect(span.attributes).toMatchObject({
      'file.path': '/project/.env',
      // Canonical open span carries file.mode (file_governance_hooks.py:traced_open).
      'file.mode': 'r',
      'tool.name': 'TabRead',
    });
    // Canonical open span carries file.operation only at the root, not as an attr.
    expect(span.attributes).not.toHaveProperty('file.operation');
    expect(span.attributes).not.toHaveProperty('openbox.tool.name');
  });

  test('canonical file spans: open carries file.mode; read/write carry file.bytes when known', () => {
    const open = buildSpan('copilotkit', 'file_open', {
      file_path: '/vault/prod.env',
      file_mode: 'r',
    });
    expect(open.attributes).toMatchObject({
      'file.path': '/vault/prod.env',
      'file.mode': 'r',
    });

    // Started read (no byte count yet) → no file.bytes attribute.
    const readStarted = buildSpan('copilotkit', 'file_read', {
      file_path: '/vault/prod.env',
    });
    expect(readStarted.attributes).not.toHaveProperty('file.bytes');

    // Completed read (byte count merged by recordOpSpanPair) → file.bytes set.
    const readCompleted = buildSpan('copilotkit', 'file_read', {
      stage: 'completed',
      file_path: '/vault/prod.env',
      bytes_read: 449,
    });
    expect(readCompleted.attributes).toMatchObject({
      'file.path': '/vault/prod.env',
      'file.operation': 'read',
      'file.bytes': 449,
    });

    const writeCompleted = buildSpan('copilotkit', 'file_write', {
      stage: 'completed',
      file_path: '/tmp/out.txt',
      bytes_written: 1175,
    });
    expect(writeCompleted.attributes).toMatchObject({
      'file.operation': 'write',
      'file.bytes': 1175,
    });
  });

  test('non-MCP tool spans expose platform tool telemetry fields when supplied', () => {
    const span = buildSpan('cursor', 'shell', {
      tool_name: 'Shell',
      command: 'npm test',
    });

    expect(span).not.toHaveProperty('semantic_type');
    expect(span.attributes).not.toHaveProperty('openbox.semantic_type');
    expect(span.attributes).toMatchObject({
      'shell.command': 'npm test',
      'tool.name': 'Shell',
      tool_name: 'Shell',
    });
    // Canonical: the synthetic openbox.* attribute is stripped.
    expect(span.attributes).not.toHaveProperty('openbox.tool.name');
  });

  test('completed operation spans carry completed phase timestamps', () => {
    const span = buildSpan('cursor', 'shell', {
      stage: 'completed',
      tool_name: 'Shell',
      command: 'npm test',
    });

    expect(span.stage).toBe('completed');
    expect(typeof span.end_time).toBe('number');
    expect(span.duration_ns).toBe(0);
  });

  test('activity metadata matches LangGraph __openbox marker shape', () => {
    expect(openBoxActivityMetadata({ toolType: ' file_read ' })).toEqual({
      __openbox: { tool_type: 'file_read' },
    });
    expect(
      openBoxActivityMetadata({
        toolType: 'a2a',
        subagentName: 'writer',
      }),
    ).toEqual({
      __openbox: { tool_type: 'a2a', subagent_name: 'writer' },
    });
    expect(openBoxActivityMetadata({ toolType: '  ' })).toBeUndefined();
    expect(
      withOpenBoxActivityMetadata([{ file_path: '/tmp/secret.txt' }], {
        toolType: 'file_read',
      }),
    ).toEqual([
      { file_path: '/tmp/secret.txt' },
      { __openbox: { tool_type: 'file_read' } },
    ]);
    expect(
      withOpenBoxSubagentActivityMetadata([{ task: 'research' }], 'researcher'),
    ).toEqual([
      { task: 'research' },
      { __openbox: { tool_type: 'a2a', subagent_name: 'researcher' } },
    ]);
  });

  test('does not pretend arbitrary result JSON is goal-alignment content', () => {
    const span: SpanData = {
      span_id: 'span-1',
      trace_id: 'trace-1',
      name: 'openbox.synthetic.model_usage',
      start_time: 1,
      end_time: 2,
      stage: 'completed',
      semantic_type: 'llm_completion',
      response_body: JSON.stringify({
        model: 'gpt',
        usage: { prompt_tokens: 4, completion_tokens: 8 },
      }),
    };

    expect(extractAssistantContentLikeCore([span])).toBe('');
  });

  test('captures raw provider bodies verbatim but always redacts sensitive headers', () => {
    const span = buildSpan('mcp', 'llm', {
      stage: 'completed',
      response: '',
      model: 'gpt-4o',
      httpStatusCode: 200,
      rawRequestBody: {
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'hi' },
        ],
        model: 'gpt-4o',
      },
      rawResponseBody: {
        id: 'chatcmpl-x',
        object: 'chat.completion',
        model: 'gpt-4o-2024-08-06',
        system_fingerprint: 'fp_x',
        service_tier: 'default',
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      },
      requestHeaders: {
        authorization: 'Bearer sk-test-RAW',
        'user-agent': 'OpenAI/Node',
        'x-stainless-lang': 'js',
      },
      responseHeaders: {
        'cf-ray': 'abc-HKG',
        'x-request-id': 'req_123',
        'openai-version': '2020-10-01',
        'set-cookie': 'sess=secret',
        'x-ratelimit-limit-tokens': '200000',
      },
    }) as Record<string, any>;

    // Raw provider bodies preserved verbatim (not synthesized).
    expect(JSON.parse(String(span.request_body))).toMatchObject({
      model: 'gpt-4o',
      messages: [{ role: 'system' }, { role: 'user' }],
    });
    expect(JSON.parse(String(span.response_body))).toMatchObject({
      id: 'chatcmpl-x',
      system_fingerprint: 'fp_x',
      service_tier: 'default',
      usage: { prompt_tokens: 10, total_tokens: 12 },
    });
    // Sensitive headers are ALWAYS redacted (canonical [REDACTED]); benign
    // headers pass through verbatim.
    expect(span.request_headers?.authorization).toBe('[REDACTED]');
    expect(span.request_headers?.['x-stainless-lang']).toBe('js');
    expect(span.response_headers?.['cf-ray']).toBe('abc-HKG');
    expect(span.response_headers?.['x-request-id']).toBe('req_123');
    // Canonical exact-set redaction: set-cookie is in the sensitive set →
    // redacted; x-ratelimit-limit-tokens is NOT (no substring heuristic) →
    // passes through with its real value, byte-for-byte with the Python SDK.
    expect(span.response_headers?.['set-cookie']).toBe('[REDACTED]');
    expect(span.response_headers?.['x-ratelimit-limit-tokens']).toBe('200000');
    expect(span.http_status_code).toBe(200);
    expect(span.attributes).toMatchObject({ 'http.status_code': 200 });
  });

  test('redacts authorization and cookie headers with the canonical sentinel', () => {
    const span = buildSpan('mcp', 'llm', {
      stage: 'completed',
      response: 'ok',
      model: 'gpt-4o',
      requestHeaders: { authorization: 'Bearer sk-secret', cookie: 'a=b' },
    }) as Record<string, any>;

    expect(span.request_headers?.authorization).toBe('[REDACTED]');
    expect(span.request_headers?.cookie).toBe('[REDACTED]');
  });

  test('generic completed LLM span passes raw capture through buildSpan (headers redacted)', () => {
    const span = buildSpan('copilotkit', 'llm', {
      stage: 'completed',
      model: 'gpt-4o',
      http_status_code: 200,
      rawRequestBody: { messages: [{ role: 'user', content: 'hi' }], model: 'gpt-4o' },
      rawResponseBody: { id: 'resp_1', usage: { prompt_tokens: 3, completion_tokens: 1 } },
      request_headers: { authorization: 'Bearer sk-raw-2' },
      response_headers: { 'x-request-id': 'req_456' },
    }) as Record<string, any>;

    expect(JSON.parse(String(span.request_body))).toMatchObject({
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(JSON.parse(String(span.response_body))).toMatchObject({ id: 'resp_1' });
    // Bodies are verbatim; the authorization header is always redacted.
    expect(span.request_headers.authorization).toBe('[REDACTED]');
    expect(span.response_headers['x-request-id']).toBe('req_456');
    expect(span.http_status_code).toBe(200);
  });
});
