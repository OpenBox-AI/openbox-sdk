import fs from 'node:fs';
import path from 'node:path';
import type { ClaudeCodeEnvelope } from '../../core-client/generated/runtime/claude-code.js';
import type { LLMTokenUsage } from '../../governance/spans.js';

const MAX_TRANSCRIPT_TAIL_BYTES = 1024 * 1024;

export interface ClaudeTranscriptUsage {
  model?: string;
  usage?: LLMTokenUsage;
  content?: string;
  hasToolCalls?: boolean;
}

interface AssistantTranscriptRecord {
  model?: string;
  usage?: LLMTokenUsage;
  content?: string;
  hasToolCalls?: boolean;
}

function toPositiveInteger(value: unknown): number | undefined {
  const numberValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : undefined;
  if (numberValue === undefined || !Number.isFinite(numberValue) || numberValue <= 0)
    return undefined;
  return Math.trunc(numberValue);
}

function normalizeClaudeUsage(value: unknown): LLMTokenUsage | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const usage = value as Record<string, unknown>;
  const normalized: LLMTokenUsage = {
    inputTokens: toPositiveInteger(usage.input_tokens),
    outputTokens: toPositiveInteger(usage.output_tokens),
    totalTokens: toPositiveInteger(usage.total_tokens),
  };
  return Object.values(normalized).some((entry) => entry !== undefined)
    ? normalized
    : undefined;
}

function sumTokenField(
  left: number | undefined,
  right: number | undefined,
): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return left + right;
}

function withDerivedTotal(usage: LLMTokenUsage): LLMTokenUsage {
  const input =
    usage.inputTokens ??
    usage.promptTokens;
  const output =
    usage.outputTokens ??
    usage.completionTokens;
  if (input === undefined && output === undefined) return usage;
  const calculatedTotal = (input ?? 0) + (output ?? 0);
  if (
    usage.totalTokens !== undefined &&
    usage.totalTokens >= calculatedTotal
  ) {
    return usage;
  }
  return {
    ...usage,
    totalTokens: calculatedTotal,
  };
}

function combineUsage(
  left: LLMTokenUsage | undefined,
  right: LLMTokenUsage | undefined,
): LLMTokenUsage | undefined {
  if (!left) return right;
  if (!right) return left;
  return {
    promptTokens: sumTokenField(left.promptTokens, right.promptTokens),
    completionTokens: sumTokenField(
      left.completionTokens,
      right.completionTokens,
    ),
    inputTokens: sumTokenField(left.inputTokens, right.inputTokens),
    outputTokens: sumTokenField(left.outputTokens, right.outputTokens),
    totalTokens: sumTokenField(left.totalTokens, right.totalTokens),
  };
}

function transcriptRecordId(
  record: { uuid?: unknown; message?: { id?: unknown } },
  index: number,
): string {
  const messageId = record.message?.id;
  if (typeof messageId === 'string' && messageId.trim()) {
    return `message:${messageId}`;
  }
  const uuid = record.uuid;
  if (typeof uuid === 'string' && uuid.trim()) return `uuid:${uuid}`;
  return `line:${index}`;
}

function textFromClaudeContent(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (Array.isArray(value)) {
    const text = value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item === null || typeof item !== 'object') return '';
        const record = item as Record<string, unknown>;
        if (typeof record.text === 'string') return record.text;
        if (typeof record.content === 'string') return record.content;
        return '';
      })
      .filter(Boolean)
      .join(' ');
    const trimmed = text.trim();
    return trimmed || undefined;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return textFromClaudeContent(record.text ?? record.content);
  }
  return undefined;
}

function contentHasToolUse(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((item) => {
    if (item === null || typeof item !== 'object') return false;
    const record = item as Record<string, unknown>;
    const type = typeof record.type === 'string' ? record.type : '';
    return type === 'tool_use' || type === 'tool_call' || type === 'function_call';
  });
}

function isSafeTranscriptPath(filePath: string): boolean {
  return (
    path.isAbsolute(filePath) &&
    filePath.endsWith('.jsonl') &&
    !filePath.includes('\0')
  );
}

function readTranscriptTail(filePath: string): string | undefined {
  if (!isSafeTranscriptPath(filePath)) return undefined;
  let fd: number | undefined;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return undefined;
    const length = Math.min(stat.size, MAX_TRANSCRIPT_TAIL_BYTES);
    const offset = Math.max(0, stat.size - length);
    const buffer = Buffer.alloc(length);
    fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, length, offset);
    return buffer.toString('utf-8');
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // best-effort cleanup
      }
    }
  }
}

export function readLatestAssistantTurn(
  env: ClaudeCodeEnvelope,
): ClaudeTranscriptUsage | undefined {
  const transcriptPath =
    env.agent_transcript_path ??
    env.transcript_path;
  if (!transcriptPath) return undefined;
  const text = readTranscriptTail(transcriptPath);
  if (!text) return undefined;

  const lines = text.split('\n').filter(Boolean);
  const assistantRecords = new Map<string, AssistantTranscriptRecord>();
  let latestModel: string | undefined;
  let latestContent: string | undefined;

  for (const [index, line] of lines.entries()) {
    const jsonStart = line.indexOf('{');
    if (jsonStart < 0) continue;
    try {
      const record = JSON.parse(line.slice(jsonStart)) as {
        type?: string;
        uuid?: unknown;
        message?: {
          id?: unknown;
          role?: string;
          model?: string;
          usage?: unknown;
          content?: unknown;
        };
      };
      if (record.type !== 'assistant' && record.message?.role !== 'assistant') {
        continue;
      }
      const usage = normalizeClaudeUsage(record.message?.usage);
      const content = textFromClaudeContent(record.message?.content);
      const hasToolCalls = contentHasToolUse(record.message?.content);
      if (!usage && !content && !hasToolCalls) continue;
      const id = transcriptRecordId(record, index);
      const previous = assistantRecords.get(id);
      const model = record.message?.model ?? previous?.model;
      assistantRecords.set(id, {
        model,
        usage: usage ?? previous?.usage,
        content: content ?? previous?.content,
        hasToolCalls: hasToolCalls || previous?.hasToolCalls,
      });
      if (record.message?.model) latestModel = record.message.model;
      if (content) latestContent = content;
    } catch {
      continue;
    }
  }

  const hasToolCalls = [...assistantRecords.values()].some(
    (record) => record.hasToolCalls,
  );
  let aggregatedUsage: LLMTokenUsage | undefined;
  for (const record of assistantRecords.values()) {
    aggregatedUsage = combineUsage(aggregatedUsage, record.usage);
  }
  aggregatedUsage = aggregatedUsage
    ? withDerivedTotal(aggregatedUsage)
    : undefined;

  if (!aggregatedUsage && !latestContent && !hasToolCalls) return undefined;
  return {
    model: latestModel,
    usage: aggregatedUsage,
    content: latestContent,
    hasToolCalls,
  };
}

export function readLatestAssistantUsage(
  env: ClaudeCodeEnvelope,
): ClaudeTranscriptUsage | undefined {
  const turn = readLatestAssistantTurn(env);
  return turn?.usage
    ? {
        model: turn.model,
        usage: turn.usage,
        content: turn.content,
        hasToolCalls: turn.hasToolCalls,
      }
    : undefined;
}
