import { describe, expect, test } from 'vitest';
import type { SpanData } from '../../ts/src/core-client/index.js';
import {
  buildLLMCompletionResponseBody,
  buildLLMCompletionSpan,
  buildSpan,
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
      name: 'openbox.copilotkit.assistant_output',
      kind: 'llm',
      start_time: 100,
      end_time: 200,
      duration_ns: 100,
      stage: 'completed',
      semantic_type: 'llm_completion',
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

  test('includes Core model-usage fields when provider metadata is present', () => {
    const span = buildLLMCompletionSpan({
      content: 'The governed request is ready.',
      model: 'gpt-4o-mini',
      usage: {
        promptTokens: 120,
        completionTokens: 35,
        totalTokens: 155,
      },
    });

    expect(JSON.parse(String(span.response_body))).toEqual({
      choices: [
        {
          message: {
            content: 'The governed request is ready.',
          },
        },
      ],
      model: 'gpt-4o-mini',
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
      input_tokens?: number;
      output_tokens?: number;
    };
    expect(observed.model).toBe('gpt-4o-mini');
    expect(observed.input_tokens).toBe(120);
    expect(observed.output_tokens).toBe(35);
    expect(span.attributes).toMatchObject({
      'gen_ai.request.model': 'gpt-4o-mini',
      'gen_ai.response.model': 'gpt-4o-mini',
      'gen_ai.usage.input_tokens': 120,
      'gen_ai.usage.output_tokens': 35,
      'openbox.semantic_type': 'llm_completion',
      'openbox.span_type': 'function',
    });
  });

  test('MCP spans expose behavior and platform tool telemetry fields', () => {
    const span = buildSpan('cursor', 'mcp', {
      tool_name: 'read_customer_file',
      tool_input: { path: 'customer.md' },
    });

    expect(span.semantic_type).toBe('llm_tool_call');
    expect(span.span_type).toBe('mcp_tool_call');
    expect(span.name).toBe('tool.read_customer_file');
    expect(span.attributes).toMatchObject({
      'gen_ai.system': 'mcp',
      'openbox.semantic_type': 'llm_tool_call',
      'openbox.span_type': 'mcp_tool_call',
      'openbox.tool.name': 'read_customer_file',
      'tool.name': 'read_customer_file',
      tool_name: 'read_customer_file',
    });
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
