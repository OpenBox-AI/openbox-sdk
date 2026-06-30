import type { GovernedPayload, SpanData } from '../core-client/index.js';
import { PRESET_ACTIVITY_TYPES } from '../core-client/generated/govern.js';
import { stampSource } from '../approvals/source.js';
import {
  buildSpan,
  withOpenBoxActivityMetadata,
  type SpanType,
} from '../governance/spans.js';
import {
  combineOpenBoxUsage,
  normalizeOpenBoxUsage,
  type NormalizedOpenBoxUsage,
} from '../governance/usage.js';
import { USAGE_NORMALIZATION_SURFACE } from '../governance/generated/capability-matrix.js';
import { buildAssistantOutputSpan } from '../governance/assistant-output.js';
import { objectRecord, arrayFrom, hasOwnKey } from '../internal/records.js';
import { firstTrimmed as firstString, stringFrom } from '../internal/strings.js';
import {
  filePathFor,
  httpTargetFor,
  httpMethodFor,
  dbStatementFor,
  dbSystemFor,
  dbOperationFor,
  isDatabaseMcpTool,
} from '../internal/tool-input.js';
import type { OpenBoxAgentsToolCallDetails } from './types.js';

export { objectRecord };

const defaultActivity = PRESET_ACTIVITY_TYPES.default;
const openAIAgentsActivity = PRESET_ACTIVITY_TYPES['openai-agents-sdk'];

export const OPENAI_AGENTS_ACTIVITY_TYPES = {
  GOAL_SIGNAL: defaultActivity.goalSignal,
  RUN: openAIAgentsActivity.runStarted,
  TOOL_STARTED: openAIAgentsActivity.toolStarted,
  TOOL_COMPLETED: openAIAgentsActivity.toolCompleted,
  HANDOFF: openAIAgentsActivity.handoff,
  GUARDRAIL: openAIAgentsActivity.guardrail,
} as const;

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
  if (spanType === 'file_open') return defaultActivity.read;
  if (spanType === 'file_write') return defaultActivity.write;
  if (spanType === 'file_delete') return defaultActivity.fileDelete;
  if (spanType === 'shell') return defaultActivity.shell;
  if (spanType === 'http') return defaultActivity.httpRequest;
  if (spanType === 'db') return defaultActivity.databaseQuery;
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
    db_system: dbSystemFor(toolName, toolInput),
    db_operation: dbOperationFor(toolInput),
    db_statement: dbStatementFor(toolInput),
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

export function runPromptSpan(input: unknown): SpanData[] | undefined {
  const prompt = promptTextForRunInput(input);
  return [
    buildSpan('openai-agents-sdk', 'llm', {
      stage: 'started',
      ...(prompt ? { prompt } : {}),
    }) as unknown as SpanData,
  ];
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
  | 'costUsd'
  | 'hasToolCalls'
  | 'finishReason'
> {
  const resultRecord = objectRecord(result);
  const rawResponses = arrayFrom(resultRecord.rawResponses);
  const usage =
    normalizeOpenBoxUsage(objectRecord(objectRecord(resultRecord.runContext).usage)) ??
    normalizeOpenBoxUsage(objectRecord(objectRecord(resultRecord.state).usage)) ??
    aggregateRawResponseUsage(rawResponses);
  return {
    llmModel: modelFromResult(resultRecord, rawResponses),
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    totalTokens: usage?.totalTokens,
    costUsd: usage?.costUsd,
    hasToolCalls: rawResponses.some(responseHasToolCalls),
    finishReason: finishReasonFromResult(resultRecord, rawResponses),
  };
}

export function runAssistantOutputSpan(
  result: unknown,
  sessionId: string,
): SpanData[] | undefined {
  const resultRecord = objectRecord(result);
  const rawResponses = arrayFrom(resultRecord.rawResponses);
  const usage =
    normalizeOpenBoxUsage(objectRecord(objectRecord(resultRecord.runContext).usage)) ??
    normalizeOpenBoxUsage(objectRecord(objectRecord(resultRecord.state).usage)) ??
    aggregateRawResponseUsage(rawResponses);
  const finishReason = finishReasonFromResult(resultRecord, rawResponses);
  return buildAssistantOutputSpan({
    source: 'openai-agents-sdk',
    content: assistantContentFromResult(resultRecord, rawResponses),
    span: { module: 'openai-agents-sdk' },
    name: 'openbox.openai-agents-sdk.assistant_output',
    model: modelFromResult(resultRecord, rawResponses),
    usage: usage?.raw,
    hasToolCalls: rawResponses.some(responseHasToolCalls),
    attributes: {
      'openbox.openai_agents_sdk.event': 'run_complete',
      ...(finishReason ? { 'gen_ai.response.finish_reasons': finishReason } : {}),
    },
    data: {
      source: 'openai-agents-sdk',
      event: 'run_complete',
      session_id: sessionId,
      raw_response_count: rawResponses.length,
    },
  });
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


function spanTypeFor(
  toolName: string,
  toolInput: Record<string, unknown>,
): SpanType | null {
  const lower = toolName.toLowerCase();
  if (lower === 'agent' || lower === 'task') return null;
  if (lower.includes('read') || toolInput.read === true) return 'file_read';
  if (
    (lower === 'open' || lower.includes('file_open') || lower.includes('open_file') || toolInput.open === true) &&
    filePathFor(toolInput)
  ) return 'file_open';
  if (lower.includes('write') || lower.includes('edit')) return 'file_write';
  if (lower.includes('delete') || lower.includes('remove'))
    return 'file_delete';
  if (lower.includes('bash') || lower.includes('shell') || toolInput.command)
    return 'shell';
  if (lower.includes('web') || toolInput.url || toolInput.uri) return 'http';
  if (isDatabaseMcpTool(toolName, toolInput)) return 'db';
  if (lower.startsWith('mcp') || lower.includes('mcp')) return 'mcp';
  return 'llm_tool_call';
}

export function promptTextForRunInput(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input === 'string') return input.trim() || undefined;
  if (Array.isArray(input)) {
    const text = input.map(promptTextForRunInput).filter(Boolean).join(' ').trim();
    return text || undefined;
  }
  const record = objectRecord(input);
  const messages = Object.prototype.hasOwnProperty.call(record, 'messages')
    ? promptTextForRunInput(record.messages)
    : undefined;
  const content = Object.prototype.hasOwnProperty.call(record, 'content')
    ? promptTextForRunInput(record.content)
    : undefined;
  return firstString(
    record.prompt,
    record.input,
    record.text,
    content,
    messages,
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

function aggregateRawResponseUsage(
  rawResponses: unknown[],
): NormalizedOpenBoxUsage | undefined {
  return combineOpenBoxUsage(...rawResponses);
}

function modelFromResult(
  resultRecord: Record<string, unknown>,
  rawResponses: unknown[],
): string | undefined {
  return firstString(
    ...USAGE_NORMALIZATION_SURFACE.providerModelFields.map((field) =>
      stringAtPath(resultRecord, field),
    ),
    objectRecord(resultRecord.state).model,
    ...rawResponses.flatMap((response) => {
      const responseRecord = objectRecord(response);
      return USAGE_NORMALIZATION_SURFACE.providerModelFields.map((field) =>
        stringAtPath(responseRecord, field),
      );
    }),
  );
}

function finishReasonFromResult(
  resultRecord: Record<string, unknown>,
  rawResponses: unknown[],
): string | undefined {
  return firstString(
    ...USAGE_NORMALIZATION_SURFACE.providerFinishReasonFields.map((field) =>
      stringAtPath(resultRecord, field),
    ),
    objectRecord(resultRecord.state).finishReason,
    objectRecord(resultRecord.state).finish_reason,
    ...rawResponses.flatMap((response) => {
      const responseRecord = objectRecord(response);
      return USAGE_NORMALIZATION_SURFACE.providerFinishReasonFields.map((field) =>
        stringAtPath(responseRecord, field),
      );
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

function assistantContentFromResult(
  resultRecord: Record<string, unknown>,
  rawResponses: unknown[],
): string | undefined {
  const direct = firstString(
    resultRecord.output,
    resultRecord.finalOutput,
    resultRecord.final_output,
    objectRecord(resultRecord.state).output,
  );
  if (direct) return direct;
  for (const response of rawResponses) {
    for (const item of arrayFrom(objectRecord(response).output)) {
      const itemRecord = objectRecord(item);
      const text = firstString(
        itemRecord.text,
        itemRecord.content,
        objectRecord(itemRecord.message).content,
      );
      if (text) return text;
    }
  }
  return undefined;
}


function stringAtPath(record: Record<string, unknown>, path: string): string | undefined {
  if (Object.prototype.hasOwnProperty.call(record, path)) {
    return stringFrom(record[path]);
  }
  if (!path.includes('.')) return stringFrom(record[path]);
  let current: unknown = record;
  for (const part of path.split('.')) {
    const currentRecord = objectRecord(current);
    if (!Object.prototype.hasOwnProperty.call(currentRecord, part)) {
      return undefined;
    }
    current = currentRecord[part];
  }
  return stringFrom(current);
}
