import type { GovernedPayload, SpanData } from '../core-client/index.js';
import { buildSpan, type LLMTokenUsage, type LLMCompletionSpanInput } from './spans.js';
import { openBoxUsageTelemetryFields } from './usage.js';

type AssistantTelemetryFields = Pick<
  GovernedPayload,
  | 'sessionId'
  | 'llmModel'
  | 'inputTokens'
  | 'outputTokens'
  | 'totalTokens'
  | 'costUsd'
  | 'hasToolCalls'
  | 'completion'
>;

export interface AssistantOutputTelemetryInput {
  source: string;
  content?: string;
  sessionId?: string;
  model?: string;
  provider?: string;
  usage?: LLMTokenUsage;
  name?: string;
  kind?: string;
  providerUrl?: string;
  requestBody?: unknown;
  responseBody?: unknown;
  requestHeaders?: unknown;
  responseHeaders?: unknown;
  httpStatusCode?: unknown;
  rawRequestBody?: unknown;
  rawResponseBody?: unknown;
  startTime?: number;
  endTime?: number;
  durationNs?: number;
  hasToolCalls?: boolean;
  span?: LLMCompletionSpanInput['span'];
  attributes?: Record<string, unknown>;
  data?: unknown;
}

function firstText(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function defaultAssistantSpanName(source: string): string {
  return `openbox.${source}.assistant_output`;
}

export function assistantOutputTelemetryFields(
  input: AssistantOutputTelemetryInput,
): AssistantTelemetryFields {
  const usage = openBoxUsageTelemetryFields(input.usage);
  return {
    sessionId: input.sessionId,
    llmModel: input.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    costUsd: usage.costUsd,
    hasToolCalls: input.hasToolCalls,
    completion: firstText(input.content),
  };
}

export function buildAssistantOutputSpan(
  input: AssistantOutputTelemetryInput,
): SpanData[] | undefined {
  const content = firstText(input.content);
  if (
    !content &&
    !input.usage &&
    input.rawRequestBody === undefined &&
    input.rawResponseBody === undefined
  ) {
    return undefined;
  }
  // The assistant output IS the LLM provider call — emit it as the canonical
  // http_request span via the single buildSpan chokepoint (langgraph py has no
  // separate "assistant_output" span; it instruments the provider POST).
  return [
    buildSpan(input.source, 'llm', {
      stage: 'completed',
      response: content,
      model: input.model,
      provider: input.provider,
      url: input.providerUrl,
      usage: input.usage,
      request_body: input.requestBody,
      response_body: input.responseBody,
      request_headers: input.requestHeaders,
      response_headers: input.responseHeaders,
      http_status_code: input.httpStatusCode,
      rawRequestBody: input.rawRequestBody,
      rawResponseBody: input.rawResponseBody,
      startTime: input.startTime,
      endTime: input.endTime,
      durationNs: input.durationNs,
      data: input.data,
    }) as unknown as SpanData,
  ];
}
