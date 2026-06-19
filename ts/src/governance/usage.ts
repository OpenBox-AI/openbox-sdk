import {
  llmTokenUsageFromRecord,
  type LLMTokenUsage,
} from './spans.js';

export interface NormalizedOpenBoxUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  webSearchRequests?: number;
  costUsd?: number;
  raw: LLMTokenUsage;
}

export function normalizeOpenBoxUsage(
  value: unknown,
): NormalizedOpenBoxUsage | undefined {
  const usage = llmTokenUsageFromRecord(value);
  if (!usage) return undefined;
  const inputTokens = firstNumber(
    usage.inputTokens,
    usage.promptTokens,
    usage.input_tokens,
    usage.prompt_tokens,
  );
  const outputTokens = firstNumber(
    usage.outputTokens,
    usage.completionTokens,
    usage.output_tokens,
    usage.completion_tokens,
  );
  return {
    inputTokens,
    outputTokens,
    totalTokens:
      firstNumber(usage.totalTokens, usage.total_tokens) ??
      derivedTotal(inputTokens, outputTokens),
    cacheReadInputTokens: firstNumber(
      usage.cacheReadInputTokens,
      usage.cache_read_input_tokens,
    ),
    cacheCreationInputTokens: firstNumber(
      usage.cacheCreationInputTokens,
      usage.cache_creation_input_tokens,
    ),
    webSearchRequests: firstNumber(
      usage.webSearchRequests,
      usage.web_search_requests,
    ),
    costUsd: firstNumber(usage.costUsd, usage.costUSD, usage.cost_usd),
    raw: usage,
  };
}

export function openBoxUsageTelemetryFields(value: unknown): {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
} {
  const usage = normalizeOpenBoxUsage(value);
  return {
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    totalTokens: usage?.totalTokens,
    costUsd: usage?.costUsd,
  };
}

export function combineOpenBoxUsage(
  ...values: unknown[]
): NormalizedOpenBoxUsage | undefined {
  let combined: LLMTokenUsage | undefined;
  for (const value of values) {
    const usage = normalizeOpenBoxUsage(value)?.raw;
    if (!usage) continue;
    combined = combined ? addUsage(combined, usage) : usage;
  }
  return normalizeOpenBoxUsage(combined);
}

function addUsage(left: LLMTokenUsage, right: LLMTokenUsage): LLMTokenUsage {
  return {
    inputTokens: add(
      firstNumber(left.inputTokens, left.promptTokens, left.input_tokens, left.prompt_tokens),
      firstNumber(right.inputTokens, right.promptTokens, right.input_tokens, right.prompt_tokens),
    ),
    outputTokens: add(
      firstNumber(left.outputTokens, left.completionTokens, left.output_tokens, left.completion_tokens),
      firstNumber(right.outputTokens, right.completionTokens, right.output_tokens, right.completion_tokens),
    ),
    totalTokens: add(
      firstNumber(left.totalTokens, left.total_tokens),
      firstNumber(right.totalTokens, right.total_tokens),
    ),
    cacheReadInputTokens: add(
      firstNumber(left.cacheReadInputTokens, left.cache_read_input_tokens),
      firstNumber(right.cacheReadInputTokens, right.cache_read_input_tokens),
    ),
    cacheCreationInputTokens: add(
      firstNumber(left.cacheCreationInputTokens, left.cache_creation_input_tokens),
      firstNumber(right.cacheCreationInputTokens, right.cache_creation_input_tokens),
    ),
    webSearchRequests: add(
      firstNumber(left.webSearchRequests, left.web_search_requests),
      firstNumber(right.webSearchRequests, right.web_search_requests),
    ),
    costUsd: add(
      firstNumber(left.costUsd, left.costUSD, left.cost_usd),
      firstNumber(right.costUsd, right.costUSD, right.cost_usd),
    ),
  };
}

function add(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return left + right;
}

function derivedTotal(
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): number | undefined {
  return inputTokens !== undefined || outputTokens !== undefined
    ? (inputTokens ?? 0) + (outputTokens ?? 0)
    : undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}
