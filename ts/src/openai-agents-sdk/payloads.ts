import type { SpanData } from '../core-client/index.js';
import { stampSource } from '../approvals/source.js';
import {
  buildSpan,
  withOpenBoxActivityMetadata,
  type SpanType,
} from '../governance/spans.js';

export const OPENAI_AGENTS_ACTIVITY_TYPES = {
  RUN: 'OpenAIAgentsSDKRun',
  TOOL_STARTED: 'ToolStarted',
  TOOL_COMPLETED: 'ToolCompleted',
  HANDOFF: 'AgentHandoff',
  GUARDRAIL: 'GuardrailEvaluation',
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

export function toolActivityType(
  toolName: string,
  toolInput: Record<string, unknown>,
): string {
  const spanType = spanTypeFor(toolName, toolInput);
  if (spanType === 'file_read') return 'FileRead';
  if (spanType === 'file_write') return 'FileEdit';
  if (spanType === 'file_delete') return 'FileDelete';
  if (spanType === 'shell') return 'ShellExecution';
  if (spanType === 'http') return 'HTTPRequest';
  if (spanType === 'mcp') return 'MCPToolCall';
  if (toolName === 'Agent' || toolName === 'Task') return 'AgentSpawn';
  return OPENAI_AGENTS_ACTIVITY_TYPES.TOOL_STARTED;
}

export function toolSpan(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolOutput?: unknown,
  stage?: 'started' | 'completed',
): SpanData[] | undefined {
  const spanType = spanTypeFor(toolName, toolInput);
  if (!spanType) return undefined;
  return [
    buildSpan('openai-agents-sdk', spanType, {
      stage,
      file_path: filePathFor(toolInput),
      command: stringFrom(toolInput.command),
      cwd: stringFrom(toolInput.cwd),
      tool_name: toolName,
      tool_input: toolInput,
      tool_output: toolOutput,
      url: httpTargetFor(toolInput),
      method: httpMethodFor(toolInput),
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

export function brandedReason(reason: string | undefined): string {
  const sanitized = (reason ?? '').replace(/[\u2014\u2013]/g, ' - ').replace(/ {2,}/g, ' ').trim();
  if (!sanitized) return '';
  return sanitized.startsWith('[OpenBox]') ? sanitized : `[OpenBox] ${sanitized}`;
}

export function redactedRecord(value: unknown): Record<string, unknown> | undefined {
  const redacted = objectRecord(unwrapInputRedaction(value));
  return Object.keys(redacted).length > 0 ? redacted : undefined;
}

export function redactedOutputValue(value: unknown, originalOutput: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  return unwrapOutputRedaction(value, originalOutput);
}

function unwrapInputRedaction(value: unknown): unknown {
  if (Array.isArray(value) && value.length === 1) return value[0];
  const record = objectRecord(value);
  if (Object.keys(record).length === 0) return value;
  if (Array.isArray(record.input) && record.input.length === 1) return record.input[0];
  if (Array.isArray(record.activity_input) && record.activity_input.length === 1) return record.activity_input[0];
  if (Array.isArray(record.activityInput) && record.activityInput.length === 1) return record.activityInput[0];
  return value;
}

function unwrapOutputRedaction(value: unknown, originalOutput: unknown): unknown {
  const record = objectRecord(value);
  if (Object.keys(record).length === 0 || hasOwnKey(originalOutput, 'output')) return value;
  if (Object.prototype.hasOwnProperty.call(record, 'output')) return record.output;
  if (Object.prototype.hasOwnProperty.call(record, 'activity_output')) return record.activity_output;
  if (Object.prototype.hasOwnProperty.call(record, 'activityOutput')) return record.activityOutput;
  return value;
}

function hasOwnKey(value: unknown, key: string): value is Record<string, unknown> {
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
  if (lower.includes('delete') || lower.includes('remove')) return 'file_delete';
  if (lower.includes('bash') || lower.includes('shell') || toolInput.command) return 'shell';
  if (lower.includes('web') || toolInput.url || toolInput.uri) return 'http';
  if (lower.startsWith('mcp') || lower.includes('mcp')) return 'mcp';
  return null;
}

function filePathFor(toolInput: Record<string, unknown>): string | undefined {
  return firstString(toolInput.file_path, toolInput.filePath, toolInput.path);
}

function httpTargetFor(toolInput: Record<string, unknown>): string | undefined {
  return firstString(toolInput.url, toolInput.uri, toolInput.href, toolInput.query);
}

function httpMethodFor(toolInput: Record<string, unknown>): string {
  return firstString(toolInput.method, toolInput.http_method, toolInput.httpMethod)?.toUpperCase() ?? 'GET';
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
