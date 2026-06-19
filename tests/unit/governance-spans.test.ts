import { describe, expect, test } from 'vitest';
import type { SpanData } from '../../ts/src/core-client/index.js';
import { assistantOutputTelemetryFields } from '../../ts/src/governance/assistant-output.js';
import {
  combineOpenBoxUsage,
  normalizeOpenBoxUsage,
  openBoxUsageTelemetryFields,
} from '../../ts/src/governance/usage.js';
import {
  buildLLMCompletionResponseBody,
  buildLLMCompletionSpan,
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
    latest.semantic_type !== 'llm_completion' ||
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
  test('normalizes token, cache, web-search, and cost usage through the shared facade', () => {
    expect(
      normalizeOpenBoxUsage({
        prompt_tokens: 3,
        completionTokens: 4,
        cache_read_input_tokens: 2,
        webSearchRequests: 1,
        cost_usd: 0.012,
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
    const span = buildLLMCompletionSpan({
      content: 'The queue has two governed requests ready.',
      span: {
        span_id: 'span-1',
        trace_id: 'trace-1',
        name: 'placeholder',
        kind: 'internal',
        start_time: 100,
        end_time: 200,
        duration_ns: 100,
        attributes: { 'openbox.copilotkit.gate': 'assistant_output' },
        data: { source: 'copilotkit' },
      },
      name: 'openbox.copilotkit.assistant_output',
      kind: 'llm',
    });

    expect(span).toMatchObject({
      span_id: 'span-1',
      trace_id: 'trace-1',
      parent_span_id: null,
      name: 'openbox.copilotkit.assistant_output',
      kind: 'llm',
      start_time: 100_000_000,
      end_time: 200_000_000,
      duration_ns: 100,
      stage: 'completed',
      semantic_type: 'llm_completion',
      status: { code: 'UNSET', description: null },
      events: [],
      error: null,
      attributes: {
        'gen_ai.system': 'openbox-sdk',
        'http.method': 'POST',
        'http.url': 'https://api.openai.com/v1/chat/completions',
        'openbox.copilotkit.gate': 'assistant_output',
      },
      data: { source: 'copilotkit' },
    });
    expect(extractAssistantContentLikeCore([span])).toBe(
      'The queue has two governed requests ready.',
    );
  });

  test('preserves source LLM span status, events, parent id, and error root fields', () => {
    const span = buildLLMCompletionSpan({
      content: 'failed',
      span: {
        span_id: 'span-1',
        trace_id: 'trace-1',
        parent_span_id: 'parent-1',
        name: 'source',
        start_time: 1,
        end_time: 2,
        duration_ns: 1,
        status: { code: 'ERROR', description: 'model failed' },
        events: [
          {
            name: 'exception',
            timestamp: 2,
            attributes: { message: 'model failed' },
          },
        ],
        error: 'model failed',
      } as SpanData & { error: string },
    });

    expect(span).toMatchObject({
      parent_span_id: 'parent-1',
      status: { code: 'ERROR', description: 'model failed' },
      events: [
        {
          name: 'exception',
          timestamp: 2,
          attributes: { message: 'model failed' },
        },
      ],
      error: 'model failed',
    });
  });

  test('includes Core model-usage fields when provider metadata is present', () => {
    const beforeNs = Date.now() * 1_000_000;
    const span = buildLLMCompletionSpan({
      content: 'The governed request is ready.',
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
    const observed = span as typeof span & {
      model?: string;
      model_id?: string;
      provider?: string;
      model_provider?: string;
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
    };
    expect(observed.model).toBe('gpt-4o-mini');
    expect(observed.model_id).toBe('gpt-4o-mini');
    expect(observed.provider).toBe('openai');
    expect(observed.model_provider).toBe('openai');
    expect(observed.input_tokens).toBe(120);
    expect(observed.output_tokens).toBe(35);
    expect(observed.total_tokens).toBe(155);
    expect(span.attributes).toMatchObject({
      'gen_ai.request.model': 'gpt-4o-mini',
      'gen_ai.response.model': 'gpt-4o-mini',
      'openbox.model.id': 'gpt-4o-mini',
      'openbox.model.provider': 'openai',
      'gen_ai.usage.input_tokens': 120,
      'gen_ai.usage.output_tokens': 35,
      'gen_ai.usage.total_tokens': 155,
      'openbox.semantic_type': 'llm_completion',
      'openbox.span_type': 'function',
    });
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

    expect(span).toMatchObject({
      semantic_type: 'llm_completion',
      model: 'gemini-2.5-flash',
      model_id: 'gemini-2.5-flash',
      provider: 'google',
      model_provider: 'google',
      input_tokens: 11,
      output_tokens: 7,
      total_tokens: 18,
      http_method: 'POST',
      http_url: 'https://generativelanguage.googleapis.com/v1beta/models/generateContent',
      attributes: {
        'http.method': 'POST',
        'http.url': 'https://generativelanguage.googleapis.com/v1beta/models/generateContent',
        'gen_ai.usage.input_tokens': 11,
        'gen_ai.usage.output_tokens': 7,
        'gen_ai.usage.total_tokens': 18,
        'openbox.model.id': 'gemini-2.5-flash',
        'openbox.model.provider': 'google',
      },
    });

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

    const span = buildLLMCompletionSpan({
      content: 'Gemini response.',
      model: 'gemini-2.5-flash',
      usage,
    });

    expect(span).toMatchObject({
      model_id: 'gemini-2.5-flash',
      provider: 'google',
      input_tokens: 11,
      output_tokens: 7,
      total_tokens: 21,
    });
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

  test('provider-prefixed model names expose model_id without changing model', () => {
    const span = buildLLMCompletionSpan({
      content: 'done',
      model: 'anthropic/claude-opus-4-8',
      usage: { inputTokens: 2, outputTokens: 3 },
    }) as ReturnType<typeof buildLLMCompletionSpan> & {
      model?: string;
      model_id?: string;
      provider?: string;
      model_provider?: string;
    };

    expect(span.model).toBe('anthropic/claude-opus-4-8');
    expect(span.model_id).toBe('claude-opus-4-8');
    expect(span.provider).toBe('anthropic');
    expect(span.model_provider).toBe('anthropic');
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
      'openbox.model.id': 'claude-opus-4-8',
      'openbox.model.provider': 'anthropic',
    });
  });

  test('normalizes Date.now-style explicit LLM span timestamps to nanoseconds', () => {
    const span = buildLLMCompletionSpan({
      content: 'done',
      startTime: 1_700_000_000_000,
      endTime: 1_700_000_000_125,
      durationNs: 125_000_000,
    });

    expect(span.start_time).toBe(1_700_000_000_000_000_000);
    expect(span.end_time).toBe(1_700_000_000_125_000_000);
    expect(span.duration_ns).toBe(125_000_000);
  });

  test('derives LLM span duration from explicit start and end timestamps', () => {
    const span = buildLLMCompletionSpan({
      content: 'done',
      startTime: 1_700_000_000_000,
      endTime: 1_700_000_000_125,
    });

    expect(span.start_time).toBe(1_700_000_000_000_000_000);
    expect(span.end_time).toBe(1_700_000_000_125_000_000);
    expect(span.duration_ns).toBe(125_000_000);
  });

  test('normalizes Date.now-style source LLM span timestamps to nanoseconds', () => {
    const span = buildLLMCompletionSpan({
      content: 'done',
      span: {
        start_time: 1_700_000_000_000,
        end_time: 1_700_000_000_250,
        duration_ns: 250_000_000,
      },
    });

    expect(span.start_time).toBe(1_700_000_000_000_000_000);
    expect(span.end_time).toBe(1_700_000_000_250_000_000);
    expect(span.duration_ns).toBe(250_000_000);
  });

  test('derives LLM span duration when source span has placeholder zero duration', () => {
    const span = buildLLMCompletionSpan({
      content: 'done',
      span: {
        start_time: 1_700_000_000_000,
        end_time: 1_700_000_000_250,
        duration_ns: 0,
      },
    });

    expect(span.start_time).toBe(1_700_000_000_000_000_000);
    expect(span.end_time).toBe(1_700_000_000_250_000_000);
    expect(span.duration_ns).toBe(250_000_000);
  });

  test('default classifier URL does not create a provider alias by itself', () => {
    const span = buildLLMCompletionSpan({
      content: 'done',
      usage: { inputTokens: 1, outputTokens: 1 },
    }) as ReturnType<typeof buildLLMCompletionSpan> & {
      provider?: string;
      model_provider?: string;
    };

    expect(span.http_url).toBe('https://api.openai.com/v1/chat/completions');
    expect(span.provider).toBeUndefined();
    expect(span.model_provider).toBeUndefined();
    expect(span.attributes).not.toHaveProperty('openbox.model.provider');
  });

  test('MCP spans expose Core classifier and platform tool telemetry fields', () => {
    const span = buildSpan('cursor', 'mcp', {
      tool_name: 'read_customer_file',
      tool_input: { path: 'customer.md' },
    });

    expect(span.semantic_type).toBe('mcp_tool_call');
    expect(span.span_type).toBe('mcp_tool_call');
    expect(span.name).toBe('MCP callTool read_customer_file');
    expect(span.attributes).toMatchObject({
      'mcp.method': 'callTool',
      'mcp.operation': 'read_customer_file',
      'mcp.server_id': 'unknown',
      'mcp.input': { path: 'customer.md' },
      'openbox.semantic_type': 'mcp_tool_call',
      'openbox.span_type': 'mcp_tool_call',
      'openbox.tool.name': 'read_customer_file',
      'tool.name': 'read_customer_file',
      tool_name: 'read_customer_file',
    });
  });

  test('non-MCP tool spans expose platform tool telemetry fields when supplied', () => {
    const span = buildSpan('cursor', 'shell', {
      tool_name: 'Shell',
      command: 'npm test',
    });

    expect(span.semantic_type).toBe('internal');
    expect(span.attributes).toMatchObject({
      'shell.command': 'npm test',
      'openbox.tool.name': 'Shell',
      'tool.name': 'Shell',
      tool_name: 'Shell',
    });
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
});
