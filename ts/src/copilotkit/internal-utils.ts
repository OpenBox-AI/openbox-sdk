import {
  MAX_RUNTIME_COLLECTION_ITEMS,
  MAX_RUNTIME_MESSAGE_CHARS,
  MAX_RUNTIME_MESSAGES,
  MAX_RUNTIME_OBJECT_KEYS,
  MAX_RUNTIME_SYSTEM_CHARS,
  MAX_RUNTIME_TOOL_CALLS,
  MAX_RUNTIME_TOOL_DESCRIPTION_CHARS,
} from './constants.js';
import type { OpenBoxSafePayload } from './types.js';

export function nowUnixNano(): number {
  return Date.now() * 1_000_000;
}

export function shouldStopForGate(gate: OpenBoxSafePayload): boolean {
  return gate.rawBlocked;
}

export function modelInput(request: {
  messages?: unknown[];
  systemPrompt?: string;
  tools?: unknown[];
}) {
  return {
    model: modelNameFromRequest(request),
    model_provider: modelProviderFromRequest(request),
    systemPrompt:
      typeof request.systemPrompt === 'string'
        ? truncate(request.systemPrompt, MAX_RUNTIME_SYSTEM_CHARS)
        : undefined,
    messages: summarizeMessages(request.messages),
    tools: Array.isArray(request.tools)
      ? request.tools
          .map((tool) => {
            const value = objectRecord(tool);
            return {
              name: value.name,
              description:
                typeof value.description === 'string'
                  ? truncate(
                      value.description,
                      MAX_RUNTIME_TOOL_DESCRIPTION_CHARS,
                    )
                  : undefined,
            };
          })
          .slice(0, 30)
      : [],
  };
}

export function modelNameFromRequest(request: unknown): string | undefined {
  return firstStringAtPaths(request, [
    'model',
    'modelName',
    'model_name',
    'ls_model_name',
    'model.model',
    'model.modelName',
    'model.model_name',
    'model.ls_model_name',
    'model.kwargs.model',
    'model.kwargs.modelName',
    'model.lc_kwargs.model',
    'model.lc_kwargs.modelName',
    'model.invocationParams.model',
    'modelInvocation.model',
  ]);
}

export function modelProviderFromRequest(request: unknown): string | undefined {
  return firstStringAtPaths(request, [
    'provider',
    'modelProvider',
    'model_provider',
    'ls_provider',
    'model.provider',
    'model.modelProvider',
    'model.model_provider',
    'model.ls_provider',
    'model.kwargs.provider',
    'model.kwargs.modelProvider',
    'model.lc_kwargs.provider',
    'model.lc_kwargs.modelProvider',
  ]);
}

export function toolCallInput(request: {
  toolCall?: { id?: string; name?: string; args?: unknown };
  tool?: { description?: string };
}) {
  return {
    id: request.toolCall?.id,
    name: request.toolCall?.name,
    args: toPlain(request.toolCall?.args),
    description: request.tool?.description,
  };
}

export function withGovernedModelInput(
  request: any,
  safe: unknown,
  changed = true,
): any {
  if (!changed) return request;
  const safeRecord = objectRecord(safe);
  if (Array.isArray(safeRecord.messages)) {
    return {
      ...request,
      messages: mergeMessageContent(request.messages, safeRecord.messages),
    };
  }
  return request;
}

export function mergeMessageContent(
  originalMessages: unknown,
  safeMessages: unknown[],
): unknown {
  if (!Array.isArray(originalMessages)) return originalMessages;
  const safeByIndex = new Map<number, Record<string, any>>();
  safeMessages.forEach((message, positionIndex) => {
    const safe = objectRecord(message);
    const numericIndex =
      typeof safe.index === 'number'
        ? safe.index
        : typeof safe.index === 'string' && safe.index.trim() !== ''
          ? Number(safe.index)
          : positionIndex;
    if (Number.isInteger(numericIndex)) {
      safeByIndex.set(numericIndex, safe);
    }
  });
  return originalMessages.map((message, index) => {
    const safe = safeByIndex.get(index) ?? {};
    if (!('content' in safe)) return message;
    const original = objectRecord(message);
    if (typeof original.lc_kwargs === 'object' && original.lc_kwargs !== null) {
      return {
        ...original,
        content: safe.content,
        lc_kwargs: {
          ...(original.lc_kwargs as Record<string, unknown>),
          content: safe.content,
        },
      };
    }
    return {
      ...original,
      content: safe.content,
    };
  });
}

export function withGovernedToolInput(request: any, safe: unknown): any {
  const safeRecord = objectRecord(safe);
  const args = safeRecord.args ?? objectRecord(safeRecord.toolCall).args;
  if (args === undefined) return request;
  return {
    ...request,
    toolCall: {
      ...request.toolCall,
      args,
    },
  };
}

export function withGovernedAssistantOutput(
  response: unknown,
  safe: unknown,
): unknown {
  if (response === safe) return response;
  if (!response || typeof response !== 'object') return safe;
  const safeRecord = objectRecord(safe);
  if (Object.keys(safeRecord).length === 0) return response;
  return {
    ...(response as Record<string, unknown>),
    ...safeRecord,
  };
}

export function parseToolResult(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return objectRecord(parsed);
    } catch {
      return {};
    }
  }
  return objectRecord(value);
}

export function summarizeMessages(messages: unknown): unknown[] {
  if (!Array.isArray(messages)) return [];
  const start = Math.max(0, messages.length - MAX_RUNTIME_MESSAGES);
  return messages.slice(start).map((message, offset) => {
    const index = start + offset;
    const value = objectRecord(message);
    const type =
      typeof value.getType === 'function'
        ? value.getType()
        : value._getType && typeof value._getType === 'function'
          ? value._getType()
          : value.type;
    const contentLimit =
      type === 'system' || type === 'SystemMessage'
        ? MAX_RUNTIME_SYSTEM_CHARS
        : MAX_RUNTIME_MESSAGE_CHARS;
    return {
      index,
      type,
      name: value.name,
      id: value.id,
      content: compactRuntimeValue(value.content, contentLimit),
      toolCalls: compactRuntimeValue(value.tool_calls ?? value.toolCalls),
    };
  });
}

export function compactRuntimeValue(
  value: unknown,
  maxStringLength = MAX_RUNTIME_MESSAGE_CHARS,
  depth = 0,
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return truncate(value, maxStringLength);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return '[Function]';
  if (depth > 3) return '[MaxDepth]';
  if (Array.isArray(value)) {
    return value
      .slice(
        0,
        depth === 0 ? MAX_RUNTIME_TOOL_CALLS : MAX_RUNTIME_COLLECTION_ITEMS,
      )
      .map((item) => compactRuntimeValue(item, maxStringLength, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !key.startsWith('_'))
        .slice(0, MAX_RUNTIME_OBJECT_KEYS)
        .map(([key, item]) => [
          key,
          compactRuntimeValue(item, maxStringLength, depth + 1),
        ]),
    );
  }
  return truncate(String(value), maxStringLength);
}

export function toPlain(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return truncate(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return '[Function]';
  if (depth > 4) return '[MaxDepth]';
  if (Array.isArray(value))
    return value.slice(0, 50).map((item) => toPlain(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !key.startsWith('_'))
        .slice(0, 50)
        .map(([key, item]) => [key, toPlain(item, depth + 1)]),
    );
  }
  return String(value);
}

export function objectRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object'
    ? (value as Record<string, any>)
    : {};
}

function firstStringAtPaths(
  value: unknown,
  paths: readonly string[],
): string | undefined {
  for (const path of paths) {
    const candidate = valueAtPath(value, path);
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function valueAtPath(value: unknown, path: string): unknown {
  let current = value;
  for (const part of path.split('.')) {
    const record = objectRecord(current);
    if (!Object.prototype.hasOwnProperty.call(record, part)) return undefined;
    current = record[part];
  }
  return current;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function errorOutput(error: unknown): Record<string, unknown> {
  return error instanceof Error
    ? { errorName: error.name, message: error.message }
    : { message: String(error) };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function truncate(value: string, maxLength = 4_000): string {
  return value.length > maxLength
    ? `${value.slice(0, maxLength)}...[truncated]`
    : value;
}

export function sessionKeyFromConfig(config: unknown): string {
  const value = objectRecord(config);
  const configurable = objectRecord(value.configurable);
  return String(
    configurable.thread_id ??
      configurable.threadId ??
      value.thread_id ??
      'default',
  );
}

export function workflowIdFromState(state: unknown): string | undefined {
  const value = objectRecord(state);
  const openboxSession = objectRecord(value.openboxSession);
  if (typeof openboxSession.workflowId === 'string')
    return openboxSession.workflowId;
  return typeof value.openboxWorkflowId === 'string'
    ? value.openboxWorkflowId
    : undefined;
}

export function runIdFromState(state: unknown): string | undefined {
  const value = objectRecord(state);
  const openboxSession = objectRecord(value.openboxSession);
  if (typeof openboxSession.runId === 'string') return openboxSession.runId;
  return typeof value.openboxRunId === 'string'
    ? value.openboxRunId
    : undefined;
}

export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function swallow(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    // Preserve the original caller error/result. Telemetry failure is best effort.
  }
}
