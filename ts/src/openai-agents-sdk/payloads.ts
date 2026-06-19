import type { GovernedPayload, SpanData } from '../core-client/index.js';
import { PRESET_ACTIVITY_TYPES } from '../core-client/generated/govern.js';
import { stampSource } from '../approvals/source.js';
import {
  buildSpan,
  llmTokenUsageFromRecord,
  withOpenBoxActivityMetadata,
  type LLMTokenUsage,
  type SpanType,
} from '../governance/spans.js';
import type { OpenBoxAgentsToolCallDetails } from './types.js';

const defaultActivity = PRESET_ACTIVITY_TYPES.default;
const openAIAgentsActivity = PRESET_ACTIVITY_TYPES['openai-agents-sdk'];

export const OPENAI_AGENTS_ACTIVITY_TYPES = {
  RUN: openAIAgentsActivity.runStarted,
  TOOL_STARTED: openAIAgentsActivity.toolStarted,
  TOOL_COMPLETED: openAIAgentsActivity.toolCompleted,
  HANDOFF: openAIAgentsActivity.handoff,
  GUARDRAIL: openAIAgentsActivity.guardrail,
} as const;

export function objectRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function compactPayload(
  input: Record<string, unknown>,
  eventCategory: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { event_category: eventCategory };
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) payload[key] = value;
  }
  return stampSource(payload, 'openai-agents-sdk');
}

export interface OpenBoxAgentsToolCallContext {
  callId: string;
  details?: OpenBoxAgentsToolCallDetails;
}

export function toolActivityType(
  toolName: string,
  toolInput: Record<string, unknown>,
): string {
  const spanType = spanTypeFor(toolName, toolInput);
  if (spanType === 'file_read') return defaultActivity.read;
  if (spanType === 'file_write') return defaultActivity.write;
  if (spanType === 'file_delete') return defaultActivity.fileDelete;
  if (spanType === 'shell') return defaultActivity.shell;
  if (spanType === 'http') return defaultActivity.httpRequest;
  if (spanType === 'mcp') return defaultActivity.mcpToolCall;
  if (toolName === 'Agent' || toolName === 'Task') return defaultActivity.agentSpawn;
  return OPENAI_AGENTS_ACTIVITY_TYPES.TOOL_STARTED;
}

export function toolSpan(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolOutput?: unknown,
  stage?: 'started' | 'completed',
  call?: OpenBoxAgentsToolCallContext,
): SpanData[] | undefined {
  const spanType = spanTypeFor(toolName, toolInput);
  if (!spanType) return undefined;
  const span = buildSpan('openai-agents-sdk', spanType, {
    stage,
    file_path: filePathFor(toolInput),
    command: stringFrom(toolInput.command),
    cwd: stringFrom(toolInput.cwd),
    tool_name: toolName,
    tool_input: toolInput,
    tool_output: toolOutput,
    url: httpTargetFor(toolInput),
    method: httpMethodFor(toolInput),
  });
  const callFields = toolCallFields(call);
  if (Object.keys(callFields).length > 0) {
    span.attributes = {
      ...objectRecord(span.attributes),
      ...toolCallAttributes(callFields),
    };
    Object.assign(span, callFields);
  }
  return [span as unknown as SpanData];
}

export function toolActivityInput(
  toolName: string,
  toolInput: Record<string, unknown>,
  payload: Record<string, unknown>,
): unknown[] {
  return withOpenBoxActivityMetadata([payload], {
    toolType: spanTypeFor(toolName, toolInput) ?? undefined,
  }) as unknown[];
}

export function toolTelemetryFields(
  toolName: string,
  toolInput: Record<string, unknown>,
): { toolName: string; toolType?: string } {
  const toolType = spanTypeFor(toolName, toolInput) ?? undefined;
  return {
    toolName,
    ...(toolType ? { toolType } : {}),
  };
}

export function toolCallFields(
  call: OpenBoxAgentsToolCallContext | undefined,
): Record<string, unknown> {
  const callId = firstString(
    call?.callId,
    call?.details?.toolCall?.callId,
    call?.details?.toolCall?.id,
  );
  const namespace = firstString(call?.details?.toolCall?.namespace);
  return {
    ...(callId ? { tool_call_id: callId } : {}),
    ...(namespace ? { tool_namespace: namespace } : {}),
  };
}

export function runTelemetryFields(
  result: unknown,
): Pick<
  GovernedPayload,
  | 'llmModel'
  | 'inputTokens'
  | 'outputTokens'
  | 'totalTokens'
  | 'hasToolCalls'
  | 'finishReason'
> {
  const resultRecord = objectRecord(result);
  const rawResponses = arrayFrom(resultRecord.rawResponses);
  const usage =
    usageFrom(objectRecord(objectRecord(resultRecord.runContext).usage)) ??
    usageFrom(objectRecord(objectRecord(resultRecord.state).usage)) ??
    aggregateRawResponseUsage(rawResponses);
  return {
    llmModel: modelFromResult(resultRecord, rawResponses),
    inputTokens: inputTokens(usage),
    outputTokens: outputTokens(usage),
    totalTokens: totalTokens(usage),
    hasToolCalls: rawResponses.some(responseHasToolCalls),
    finishReason: finishReasonFromResult(resultRecord, rawResponses),
  };
}

export function brandedReason(reason: string | undefined): string {
  const sanitized = (reason ?? '')
    .replace(/[\u2014\u2013]/g, ' - ')
    .replace(/ {2,}/g, ' ')
    .trim();
  if (!sanitized) return '';
  return sanitized.startsWith('[OpenBox]')
    ? sanitized
    : `[OpenBox] ${sanitized}`;
}

export function redactedRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  const redacted = objectRecord(unwrapInputRedaction(value));
  return Object.keys(redacted).length > 0 ? redacted : undefined;
}

export function redactedOutputValue(
  value: unknown,
  originalOutput: unknown,
): unknown {
  if (value === undefined || value === null) return undefined;
  return unwrapOutputRedaction(value, originalOutput);
}

function unwrapInputRedaction(value: unknown): unknown {
  if (Array.isArray(value) && value.length === 1) return value[0];
  const record = objectRecord(value);
  if (Object.keys(record).length === 0) return value;
  if (Array.isArray(record.input) && record.input.length === 1)
    return record.input[0];
  if (
    Array.isArray(record.activity_input) &&
    record.activity_input.length === 1
  )
    return record.activity_input[0];
  if (Array.isArray(record.activityInput) && record.activityInput.length === 1)
    return record.activityInput[0];
  return value;
}

function unwrapOutputRedaction(
  value: unknown,
  originalOutput: unknown,
): unknown {
  const record = objectRecord(value);
  if (Object.keys(record).length === 0 || hasOwnKey(originalOutput, 'output'))
    return value;
  if (Object.prototype.hasOwnProperty.call(record, 'output'))
    return record.output;
  if (Object.prototype.hasOwnProperty.call(record, 'activity_output'))
    return record.activity_output;
  if (Object.prototype.hasOwnProperty.call(record, 'activityOutput'))
    return record.activityOutput;
  return value;
}

function hasOwnKey(
  value: unknown,
  key: string,
): value is Record<string, unknown> {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, key),
  );
}

function spanTypeFor(
  toolName: string,
  toolInput: Record<string, unknown>,
): SpanType | null {
  const lower = toolName.toLowerCase();
  if (lower.includes('read') || toolInput.read === true) return 'file_read';
  if (lower.includes('write') || lower.includes('edit')) return 'file_write';
  if (lower.includes('delete') || lower.includes('remove'))
    return 'file_delete';
  if (lower.includes('bash') || lower.includes('shell') || toolInput.command)
    return 'shell';
  if (lower.includes('web') || toolInput.url || toolInput.uri) return 'http';
  if (lower.startsWith('mcp') || lower.includes('mcp')) return 'mcp';
  return null;
}

function filePathFor(toolInput: Record<string, unknown>): string | undefined {
  return firstString(toolInput.file_path, toolInput.filePath, toolInput.path);
}

function httpTargetFor(toolInput: Record<string, unknown>): string | undefined {
  return firstString(
    toolInput.url,
    toolInput.uri,
    toolInput.href,
    toolInput.query,
  );
}

function httpMethodFor(toolInput: Record<string, unknown>): string {
  return (
    firstString(
      toolInput.method,
      toolInput.http_method,
      toolInput.httpMethod,
    )?.toUpperCase() ?? 'GET'
  );
}

function toolCallAttributes(
  callFields: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(callFields.tool_call_id
      ? { 'openbox.tool.call_id': callFields.tool_call_id }
      : {}),
    ...(callFields.tool_namespace
      ? { 'openbox.tool.namespace': callFields.tool_namespace }
      : {}),
  };
}

function usageFrom(value: unknown): LLMTokenUsage | undefined {
  return llmTokenUsageFromRecord(value);
}

function inputTokens(usage: LLMTokenUsage | undefined): number | undefined {
  return usage?.promptTokens ?? usage?.inputTokens;
}

function outputTokens(usage: LLMTokenUsage | undefined): number | undefined {
  return usage?.completionTokens ?? usage?.outputTokens;
}

function totalTokens(usage: LLMTokenUsage | undefined): number | undefined {
  if (!usage) return undefined;
  if (usage.totalTokens !== undefined) return usage.totalTokens;
  const input = inputTokens(usage);
  const output = outputTokens(usage);
  return input !== undefined || output !== undefined
    ? (input ?? 0) + (output ?? 0)
    : undefined;
}

function aggregateRawResponseUsage(
  rawResponses: unknown[],
): LLMTokenUsage | undefined {
  let input: number | undefined;
  let output: number | undefined;
  let total: number | undefined;
  for (const response of rawResponses) {
    const usage = usageFrom(objectRecord(response).usage);
    input = addTokenValue(input, inputTokens(usage));
    output = addTokenValue(output, outputTokens(usage));
    total = addTokenValue(total, totalTokens(usage));
  }
  return input !== undefined || output !== undefined || total !== undefined
    ? {
        promptTokens: input,
        inputTokens: input,
        completionTokens: output,
        outputTokens: output,
        totalTokens: total,
      }
    : undefined;
}

function addTokenValue(
  left: number | undefined,
  right: number | undefined,
): number | undefined {
  return right === undefined ? left : (left ?? 0) + right;
}

function modelFromResult(
  resultRecord: Record<string, unknown>,
  rawResponses: unknown[],
): string | undefined {
  return firstString(
    resultRecord.model,
    objectRecord(resultRecord.state).model,
    ...rawResponses.flatMap((response) => {
      const responseRecord = objectRecord(response);
      const providerData = objectRecord(responseRecord.providerData);
      return [
        responseRecord.model,
        providerData.model,
        objectRecord(providerData.response).model,
        objectRecord(providerData.rawResponse).model,
      ];
    }),
  );
}

function finishReasonFromResult(
  resultRecord: Record<string, unknown>,
  rawResponses: unknown[],
): string | undefined {
  return firstString(
    resultRecord.finishReason,
    resultRecord.finish_reason,
    objectRecord(resultRecord.state).finishReason,
    objectRecord(resultRecord.state).finish_reason,
    ...rawResponses.flatMap((response) => {
      const providerData = objectRecord(objectRecord(response).providerData);
      return [
        objectRecord(response).finishReason,
        objectRecord(response).finish_reason,
        providerData.finishReason,
        providerData.finish_reason,
        objectRecord(providerData.response).finish_reason,
      ];
    }),
  );
}

function responseHasToolCalls(response: unknown): boolean {
  const output = arrayFrom(objectRecord(response).output);
  return output.some((item) => {
    const itemType = stringFrom(objectRecord(item).type)?.toLowerCase();
    return itemType === 'function_call' || itemType?.includes('tool') === true;
  });
}

function arrayFrom(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0)
      return value.trim();
  }
  return undefined;
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}
