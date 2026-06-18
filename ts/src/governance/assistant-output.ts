import type { GovernedPayload, SpanData } from '../core-client/index.js';
import {
  buildLLMCompletionSpan,
  type LLMTokenUsage,
  type LLMCompletionSpanInput,
} from './spans.js';

type AssistantTelemetryFields = Pick<
  GovernedPayload,
  | 'sessionId'
  | 'llmModel'
  | 'inputTokens'
  | 'outputTokens'
  | 'totalTokens'
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

function inputTokens(usage: LLMTokenUsage | undefined): number | undefined {
  return (
    usage?.promptTokens ??
    usage?.prompt_tokens ??
    usage?.inputTokens ??
    usage?.input_tokens
  );
}

function outputTokens(usage: LLMTokenUsage | undefined): number | undefined {
  return (
    usage?.completionTokens ??
    usage?.completion_tokens ??
    usage?.outputTokens ??
    usage?.output_tokens
  );
}

function totalTokens(usage: LLMTokenUsage | undefined): number | undefined {
  if (!usage) return undefined;
  if (usage.totalTokens !== undefined) return usage.totalTokens;
  if (usage.total_tokens !== undefined) return usage.total_tokens;
  const input = inputTokens(usage);
  const output = outputTokens(usage);
  return input !== undefined || output !== undefined
    ? (input ?? 0) + (output ?? 0)
    : undefined;
}

function defaultAssistantSpanName(source: string): string {
  return `openbox.${source}.assistant_output`;
}

export function assistantOutputTelemetryFields(
  input: AssistantOutputTelemetryInput,
): AssistantTelemetryFields {
  return {
    sessionId: input.sessionId,
    llmModel: input.model,
    inputTokens: inputTokens(input.usage),
    outputTokens: outputTokens(input.usage),
    totalTokens: totalTokens(input.usage),
    hasToolCalls: input.hasToolCalls,
    completion: firstText(input.content),
  };
}

export function buildAssistantOutputSpan(
  input: AssistantOutputTelemetryInput,
): SpanData[] | undefined {
  const content = firstText(input.content);
  if (!content && !input.usage) return undefined;
  return [
    buildLLMCompletionSpan({
      content: content ?? '',
      span: input.span,
      name: input.name ?? defaultAssistantSpanName(input.source),
      kind: input.kind ?? 'llm',
      system: input.source,
      model: input.model,
      provider: input.provider,
      usage: input.usage,
      requestBody: input.requestBody,
      responseBody: input.responseBody,
      providerUrl: input.providerUrl,
      startTime: input.startTime,
      endTime: input.endTime,
      durationNs: input.durationNs,
      attributes: {
        'gen_ai.system': input.source,
        ...(input.attributes ?? {}),
      },
      data: input.data,
    }),
  ];
}
