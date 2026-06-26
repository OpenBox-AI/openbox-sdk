import {
  llmTokenUsageFromRecord,
  type LLMTokenUsage,
} from './spans.js';
import { USAGE_NORMALIZATION_SURFACE } from './generated/capability-matrix.js';

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
  const inputTokens = firstNumberForAliases(usage, USAGE_NORMALIZATION_SURFACE.inputTokenAliases);
  const outputTokens = firstNumberForAliases(usage, USAGE_NORMALIZATION_SURFACE.outputTokenAliases);
  const explicitTotalTokens = firstNumberForAliases(usage, USAGE_NORMALIZATION_SURFACE.totalTokenAliases);
  const calculatedTotalTokens = derivedTotal(inputTokens, outputTokens);
  const totalTokens =
    explicitTotalTokens !== undefined && calculatedTotalTokens !== undefined
      ? Math.max(explicitTotalTokens, calculatedTotalTokens)
      : explicitTotalTokens ?? calculatedTotalTokens;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cacheReadInputTokens: firstNumberForAliases(
      usage,
      USAGE_NORMALIZATION_SURFACE.cacheReadInputTokenAliases,
    ),
    cacheCreationInputTokens: firstNumberForAliases(
      usage,
      USAGE_NORMALIZATION_SURFACE.cacheCreationInputTokenAliases,
    ),
    webSearchRequests: firstNumberForAliases(
      usage,
      USAGE_NORMALIZATION_SURFACE.webSearchRequestAliases,
    ),
    costUsd: firstNumberForAliases(usage, USAGE_NORMALIZATION_SURFACE.costUsdAliases),
    raw: withCanonicalTotal(usage, totalTokens),
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
      firstNumberForAliases(left, USAGE_NORMALIZATION_SURFACE.inputTokenAliases),
      firstNumberForAliases(right, USAGE_NORMALIZATION_SURFACE.inputTokenAliases),
    ),
    outputTokens: add(
      firstNumberForAliases(left, USAGE_NORMALIZATION_SURFACE.outputTokenAliases),
      firstNumberForAliases(right, USAGE_NORMALIZATION_SURFACE.outputTokenAliases),
    ),
    totalTokens: add(
      firstNumberForAliases(left, USAGE_NORMALIZATION_SURFACE.totalTokenAliases),
      firstNumberForAliases(right, USAGE_NORMALIZATION_SURFACE.totalTokenAliases),
    ),
    cacheReadInputTokens: add(
      firstNumberForAliases(left, USAGE_NORMALIZATION_SURFACE.cacheReadInputTokenAliases),
      firstNumberForAliases(right, USAGE_NORMALIZATION_SURFACE.cacheReadInputTokenAliases),
    ),
    cacheCreationInputTokens: add(
      firstNumberForAliases(left, USAGE_NORMALIZATION_SURFACE.cacheCreationInputTokenAliases),
      firstNumberForAliases(right, USAGE_NORMALIZATION_SURFACE.cacheCreationInputTokenAliases),
    ),
    webSearchRequests: add(
      firstNumberForAliases(left, USAGE_NORMALIZATION_SURFACE.webSearchRequestAliases),
      firstNumberForAliases(right, USAGE_NORMALIZATION_SURFACE.webSearchRequestAliases),
    ),
    costUsd: add(
      firstNumberForAliases(left, USAGE_NORMALIZATION_SURFACE.costUsdAliases),
      firstNumberForAliases(right, USAGE_NORMALIZATION_SURFACE.costUsdAliases),
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

function withCanonicalTotal(
  usage: LLMTokenUsage,
  totalTokens: number | undefined,
): LLMTokenUsage {
  if (totalTokens === undefined || usage.totalTokens === totalTokens) {
    return usage;
  }
  return {
    ...usage,
    totalTokens,
  };
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function firstNumberForAliases(
  value: LLMTokenUsage,
  aliases: readonly string[],
): number | undefined {
  const record = value as Record<string, unknown>;
  return firstNumber(...aliases.map((alias) => record[alias]));
}
