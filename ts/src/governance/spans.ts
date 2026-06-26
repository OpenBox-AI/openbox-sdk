// Span builder for governance evaluate payloads. Shared across every
// host adapter so behavior rules see the same span shapes regardless
// of which host invoked the action.
//
// Behavior rules match Core-computed semantic types derived from
// classifier gate attributes (`file.path`, `http.method`, `db.system`,
// `gen_ai.system`, `shell.command`); see
// `skill/references/span-reference.md`. Activity type alone does not
// trigger a behavior rule. Without a span that carries the right
// gate attributes the request falls through to default-allow.
//
// The `host` parameter on `buildSpan()` populates the `module` field
// and `gen_ai.system` for LLM spans so backend telemetry can
// distinguish traffic by originating adapter.

import type { SpanData } from '../core-client/index.js';
import { USAGE_NORMALIZATION_SURFACE } from './generated/capability-matrix.js';

function hex(len: number): string {
  return Array.from({ length: len }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join('');
}

interface SpanBase {
  span_id: string;
  trace_id: string;
  parent_span_id: null;
  kind: string;
  span_type: string;
  stage: string;
  start_time: number;
  end_time: number | null;
  duration_ns: number | null;
  status: { code: string; description: string | null };
  events: never[];
  error: string | null;
}

function errorDescription(value: unknown): string | undefined {
  if (value instanceof Error) return value.message || value.name;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (value === undefined || value === null) return undefined;
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}

function spanStatusOrDefault(
  status: unknown,
  error: string | undefined,
): { code: string; description?: string | null } {
  return status && typeof status === 'object' && !Array.isArray(status)
    ? (status as { code: string; description?: string | null })
    : { code: error ? 'ERROR' : 'UNSET', description: error ?? null };
}

function base(
  stage: 'started' | 'completed' = 'started',
  error?: unknown,
): SpanBase {
  const now = Date.now() * 1_000_000;
  const description = errorDescription(error);
  return {
    span_id: hex(16),
    trace_id: hex(32),
    parent_span_id: null,
    kind: 'CLIENT',
    span_type: 'function',
    stage,
    start_time: now,
    end_time: stage === 'completed' ? now : null,
    duration_ns: stage === 'completed' ? 0 : null,
    status: { code: description ? 'ERROR' : 'UNSET', description: description ?? null },
    events: [],
    error: description ?? null,
  };
}

export type SpanType =
  | 'llm'
  | 'llm_embedding'
  | 'llm_tool_call'
  | 'file_read'
  | 'file_open'
  | 'file_write'
  | 'file_delete'
  | 'shell'
  | 'mcp'
  | 'http'
  | 'db';

export interface SpanInput {
  stage?: 'started' | 'completed';
  prompt?: string;
  response?: string;
  model?: string;
  usage?: LLMTokenUsage;
  file_path?: string;
  command?: string;
  cwd?: string;
  tool_name?: string;
  tool?: string;
  tool_input?: unknown;
  tool_output?: unknown;
  server?: string;
  server_id?: string;
  mcp_server_id?: string;
  mcp_method?: string;
  mcp_operation?: string;
  url?: string;
  method?: string;
  db_system?: string;
  system?: string;
  db_operation?: string;
  operation?: string;
  db_statement?: string;
  statement?: string;
  query?: string;
  error?: unknown;
}

export interface LLMCompletionSpanInput {
  content: string;
  span?: Partial<SpanData>;
  name?: string;
  kind?: string;
  system?: string;
  model?: string;
  provider?: string;
  usage?: LLMTokenUsage;
  requestBody?: unknown;
  responseBody?: unknown;
  providerUrl?: string;
  startTime?: number;
  endTime?: number;
  durationNs?: number;
  attributes?: Record<string, unknown>;
  data?: unknown;
}

export interface LLMTokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  webSearchRequests?: number;
  costUSD?: number;
  costUsd?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  web_search_requests?: number;
  cost_usd?: number;
  promptTokenCount?: number;
  inputTokenCount?: number;
  candidatesTokenCount?: number;
  outputTokenCount?: number;
  responseTokenCount?: number;
  totalTokenCount?: number;
  prompt_token_count?: number;
  input_token_count?: number;
  candidates_token_count?: number;
  output_token_count?: number;
  response_token_count?: number;
  total_token_count?: number;
}

export function withSpanActivityId<T>(span: T, activityId?: string): T {
  if (!activityId || !span || typeof span !== 'object' || Array.isArray(span)) {
    return span;
  }
  const record = span as Record<string, unknown>;
  if (typeof record.activity_id === 'string' && record.activity_id.trim() !== '') {
    return span;
  }
  return {
    ...record,
    activity_id: activityId,
  } as T;
}

type JsonRecord = Record<string, unknown>;
export interface OpenBoxActivityMetadataInput {
  toolType?: string | null;
  subagentName?: string | null;
}

type ObservableSpan = SpanData & {
  span_type?: string;
  model?: string;
  model_id?: string;
  provider?: string;
  model_provider?: string;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  web_search_requests?: number;
  cost_usd?: number;
};

function objectRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function parseJsonRecord(value: unknown): JsonRecord {
  if (typeof value === 'string') {
    try {
      return objectRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return objectRecord(value);
}

function stringifyBody(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function toUsageInteger(value: unknown): number | undefined {
  const numberValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : undefined;
  if (
    numberValue === undefined ||
    !Number.isFinite(numberValue) ||
    (USAGE_NORMALIZATION_SURFACE.tokenValuesRequireIntegers &&
      !Number.isInteger(numberValue)) ||
    numberValue < USAGE_NORMALIZATION_SURFACE.minimumValue
  )
    return undefined;
  return numberValue;
}

function toUsageNumber(value: unknown): number | undefined {
  const numberValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : undefined;
  if (
    numberValue === undefined ||
    !Number.isFinite(numberValue) ||
    numberValue < USAGE_NORMALIZATION_SURFACE.minimumValue
  )
    return undefined;
  return numberValue;
}

function normalizeSpanTimestamp(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const timestamp = Math.trunc(value);
  // JavaScript Date.now() values are currently 13 digits. Span timestamps
  // are Unix nanoseconds in the Python SDK hooks and Core span storage.
  return timestamp > 0 && timestamp < 100_000_000_000_000
    ? timestamp * 1_000_000
    : timestamp;
}

function isDateNowTimestamp(value: number): boolean {
  return value > 0 && value < 100_000_000_000_000;
}

function normalizeDurationNs(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.trunc(value));
}

function deriveDurationNs(
  startTime: number | undefined,
  endTime: number | undefined,
): number | undefined {
  if (startTime === undefined || endTime === undefined) return undefined;
  return Math.max(0, endTime - startTime);
}

function deriveDurationNsFromRawTimestamps(
  startTime: number | undefined,
  endTime: number | undefined,
): number | undefined {
  if (
    startTime === undefined ||
    endTime === undefined ||
    !Number.isFinite(startTime) ||
    !Number.isFinite(endTime)
  ) {
    return undefined;
  }
  if (isDateNowTimestamp(startTime) && isDateNowTimestamp(endTime)) {
    return Math.max(0, Math.trunc((endTime - startTime) * 1_000_000));
  }
  return Math.max(0, Math.trunc(endTime - startTime));
}

export function llmTokenUsageFromRecord(value: unknown): LLMTokenUsage | undefined {
  const record = objectRecord(value);
  const records = usageCandidateRecords(record);
  const promptTokens = firstUsageIntegerForAliases(
    records,
    USAGE_NORMALIZATION_SURFACE.inputTokenAliases,
  );
  const completionTokens = firstUsageIntegerForAliases(
    records,
    USAGE_NORMALIZATION_SURFACE.outputTokenAliases,
  );
  const totalTokens = firstUsageIntegerForAliases(
    records,
    USAGE_NORMALIZATION_SURFACE.totalTokenAliases,
  );
  const cacheReadInputTokens = firstUsageIntegerForAliases(
    records,
    USAGE_NORMALIZATION_SURFACE.cacheReadInputTokenAliases,
  );
  const cacheCreationInputTokens = firstUsageIntegerForAliases(
    records,
    USAGE_NORMALIZATION_SURFACE.cacheCreationInputTokenAliases,
  );
  const webSearchRequests = firstUsageIntegerForAliases(
    records,
    USAGE_NORMALIZATION_SURFACE.webSearchRequestAliases,
  );
  const costUsd = firstUsageNumberForAliases(
    records,
    USAGE_NORMALIZATION_SURFACE.costUsdAliases,
  );
  const usage: LLMTokenUsage = {
    promptTokens,
    completionTokens,
    inputTokens: promptTokens,
    outputTokens: completionTokens,
    totalTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    webSearchRequests,
    costUSD: costUsd,
    costUsd,
  };
  return Object.values(usage).some((entry) => entry !== undefined)
    ? usage
    : undefined;
}

function firstUsageIntegerForAliases(
  recordOrRecords: JsonRecord | readonly JsonRecord[],
  aliases: readonly string[],
): number | undefined {
  const records = Array.isArray(recordOrRecords) ? recordOrRecords : [recordOrRecords];
  for (const record of records) {
    for (const alias of aliases) {
      const value = toUsageInteger(valueAtPath(record, alias));
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

function firstUsageNumberForAliases(
  recordOrRecords: JsonRecord | readonly JsonRecord[],
  aliases: readonly string[],
): number | undefined {
  const records = Array.isArray(recordOrRecords) ? recordOrRecords : [recordOrRecords];
  for (const record of records) {
    for (const alias of aliases) {
      const value = toUsageNumber(valueAtPath(record, alias));
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

function usageCandidateRecords(record: JsonRecord): JsonRecord[] {
  const candidates = [record];
  for (const container of USAGE_NORMALIZATION_SURFACE.providerUsageContainers) {
    const nested = objectRecord(valueAtPath(record, container));
    if (Object.keys(nested).length > 0) candidates.push(nested);
  }
  return candidates;
}

function valueAtPath(record: JsonRecord, path: string): unknown {
  if (Object.prototype.hasOwnProperty.call(record, path)) return record[path];
  if (!path.includes('.')) return record[path];
  let current: unknown = record;
  for (const part of path.split('.')) {
    const currentRecord = objectRecord(current);
    if (!Object.prototype.hasOwnProperty.call(currentRecord, part)) {
      return undefined;
    }
    current = currentRecord[part];
  }
  return current;
}

function normalizeUsage(usage?: LLMTokenUsage): JsonRecord | undefined {
  const normalizedUsage = llmTokenUsageFromRecord(usage);
  if (!normalizedUsage) return undefined;
  const normalizedUsageRecord = normalizedUsage as JsonRecord;
  const promptTokens = firstUsageIntegerForAliases(
    normalizedUsageRecord,
    USAGE_NORMALIZATION_SURFACE.inputTokenAliases,
  );
  const completionTokens = firstUsageIntegerForAliases(
    normalizedUsageRecord,
    USAGE_NORMALIZATION_SURFACE.outputTokenAliases,
  );
  const totalTokens = firstUsageIntegerForAliases(
    normalizedUsageRecord,
    USAGE_NORMALIZATION_SURFACE.totalTokenAliases,
  );
  const cacheReadInputTokens = firstUsageIntegerForAliases(
    normalizedUsageRecord,
    USAGE_NORMALIZATION_SURFACE.cacheReadInputTokenAliases,
  );
  const cacheCreationInputTokens = firstUsageIntegerForAliases(
    normalizedUsageRecord,
    USAGE_NORMALIZATION_SURFACE.cacheCreationInputTokenAliases,
  );
  const webSearchRequests = firstUsageIntegerForAliases(
    normalizedUsageRecord,
    USAGE_NORMALIZATION_SURFACE.webSearchRequestAliases,
  );
  const costUsd = firstUsageNumberForAliases(
    normalizedUsageRecord,
    USAGE_NORMALIZATION_SURFACE.costUsdAliases,
  );
  const derivedTotalTokens =
    totalTokens ??
    (promptTokens !== undefined || completionTokens !== undefined
      ? (promptTokens ?? 0) + (completionTokens ?? 0)
      : undefined);
  const normalized: JsonRecord = {};
  if (promptTokens !== undefined) {
    normalized.prompt_tokens = promptTokens;
    normalized.input_tokens = promptTokens;
  }
  if (completionTokens !== undefined) {
    normalized.completion_tokens = completionTokens;
    normalized.output_tokens = completionTokens;
  }
  if (derivedTotalTokens !== undefined) normalized.total_tokens = derivedTotalTokens;
  if (cacheReadInputTokens !== undefined) {
    normalized.cache_read_input_tokens = cacheReadInputTokens;
  }
  if (cacheCreationInputTokens !== undefined) {
    normalized.cache_creation_input_tokens = cacheCreationInputTokens;
  }
  if (webSearchRequests !== undefined) normalized.web_search_requests = webSearchRequests;
  if (costUsd !== undefined) normalized.cost_usd = costUsd;
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function firstTrimmed(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function normalizeProvider(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized.includes('openai')) return 'openai';
  if (normalized.includes('anthropic')) return 'anthropic';
  if (normalized.includes('google') || normalized.includes('gemini')) return 'google';
  return normalized;
}

function parseModelIdentifier(value: string | undefined): {
  modelId?: string;
  provider?: string;
} {
  const trimmed = value?.trim();
  if (!trimmed) return {};
  const slashParts = trimmed.split('/');
  if (slashParts.length >= 2) {
    const possibleProvider = normalizeProvider(slashParts[0]);
    const modelPart = slashParts.slice(1).join('/').trim();
    if (possibleProvider && modelPart) {
      return { modelId: modelPart, provider: possibleProvider };
    }
  }
  return { modelId: trimmed };
}

function inferProviderFromModelId(modelId: string | undefined): string | undefined {
  const normalized = modelId?.toLowerCase();
  if (!normalized) return undefined;
  if (
    normalized.startsWith('gpt-') ||
    normalized.startsWith('o1') ||
    normalized.startsWith('o3') ||
    normalized.startsWith('o4')
  ) {
    return 'openai';
  }
  if (normalized.startsWith('claude-')) return 'anthropic';
  if (normalized.startsWith('gemini')) return 'google';
  return undefined;
}

function inferProviderFromUrl(url: string | undefined): string | undefined {
  const normalized = url?.toLowerCase();
  if (!normalized) return undefined;
  if (normalized.includes('api.openai.com')) return 'openai';
  if (normalized.includes('api.anthropic.com')) return 'anthropic';
  if (normalized.includes('generativelanguage.googleapis.com')) return 'google';
  return undefined;
}

function modelTelemetryFields(
  model: string | undefined,
  explicitProvider: string | undefined,
  providerUrl: string | undefined,
): {
  modelId?: string;
  provider?: string;
} {
  const parsed = parseModelIdentifier(model);
  const provider =
    normalizeProvider(explicitProvider) ??
    parsed.provider ??
    inferProviderFromModelId(parsed.modelId) ??
    inferProviderFromUrl(providerUrl);
  return {
    modelId: firstTrimmed(parsed.modelId),
    provider,
  };
}

function providerUrlForLLM(provider: string | undefined): string {
  switch (provider) {
    case 'anthropic':
      return 'https://api.anthropic.com/v1/messages';
    case 'google':
      return 'https://generativelanguage.googleapis.com/v1beta/models/generateContent';
    case 'openai':
    default:
      return 'https://api.openai.com/v1/chat/completions';
  }
}

export function stripServerComputedSemantic<T extends object>(span: T): T {
  const next: Record<string, unknown> = {
    ...(span as Record<string, unknown>),
  };
  delete next.semantic_type;
  delete next.semanticType;

  const attrs = next.attributes;
  if (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) {
    const nextAttrs = { ...(attrs as JsonRecord) };
    delete nextAttrs['openbox.semantic_type'];
    next.attributes = nextAttrs;
  }

  return next as unknown as T;
}

export function serverComputedSemanticType(
  type: SpanType,
  input: SpanInput = {},
): string {
  switch (type) {
    case 'llm':
      return 'llm_completion';
    case 'llm_embedding':
      return 'llm_embedding';
    case 'llm_tool_call':
      return 'llm_tool_call';
    case 'file_read':
    case 'file_open':
    case 'file_write':
    case 'file_delete':
      return type;
    case 'shell':
      return 'internal';
    case 'mcp':
      return 'mcp_tool_call';
    case 'http': {
      const method = (input.method ?? 'GET').trim().toLowerCase();
      return ['get', 'post', 'put', 'patch', 'delete'].includes(method)
        ? `http_${method}`
        : 'http';
    }
    case 'db': {
      const operation = (
        input.db_operation ??
        input.operation ??
        'query'
      ).trim().toLowerCase();
      return ['select', 'insert', 'update', 'delete'].includes(operation)
        ? `database_${operation}`
        : 'database_query';
    }
  }
}

export function withServerComputedSemantic<T extends Record<string, unknown>>(
  span: T,
  type: SpanType,
  input: SpanInput = {},
): T {
  return {
    ...span,
    semantic_type: serverComputedSemanticType(type, input),
  };
}

function toolNameAttributes(input: SpanInput): JsonRecord {
  const toolName = (input.tool_name ?? input.tool)?.trim();
  if (!toolName) return {};
  return {
    'openbox.tool.name': toolName,
    'tool.name': toolName,
    tool_name: toolName,
  };
}

function mcpIdentity(input: SpanInput): {
  method: string;
  operation: string;
  serverId: string;
} {
  const toolName = input.tool_name ?? input.tool ?? 'call';
  const parts = toolName.split('__');
  const serverFromClaudeName =
    parts.length >= 3 && parts[0] === 'mcp' ? parts[1] : undefined;
  const operationFromClaudeName =
    parts.length >= 3 && parts[0] === 'mcp' ? parts.slice(2).join('__') : undefined;
  return {
    method: firstTrimmed(input.mcp_method) ?? 'callTool',
    operation: firstTrimmed(input.mcp_operation, operationFromClaudeName, toolName) ?? 'call',
    serverId:
      firstTrimmed(
        input.mcp_server_id,
        input.server_id,
        input.server,
        serverFromClaudeName,
      ) ?? 'unknown',
  };
}

export function openBoxActivityMetadata(
  input: OpenBoxActivityMetadataInput,
): { __openbox: { tool_type?: string; subagent_name?: string } } | undefined {
  const metadata: { tool_type?: string; subagent_name?: string } = {};
  const toolType = typeof input.toolType === 'string' ? input.toolType.trim() : '';
  const subagentName = typeof input.subagentName === 'string' ? input.subagentName.trim() : '';
  if (toolType) metadata.tool_type = toolType;
  if (subagentName) metadata.subagent_name = subagentName;
  return Object.keys(metadata).length > 0 ? { __openbox: metadata } : undefined;
}

export function withOpenBoxActivityMetadata<T extends readonly unknown[] | undefined>(
  input: T,
  metadata: OpenBoxActivityMetadataInput,
): T | unknown[] {
  const marker = openBoxActivityMetadata(metadata);
  if (!marker) return input;
  return [...(input ?? []), marker];
}

export function withOpenBoxSubagentActivityMetadata<
  T extends readonly unknown[] | undefined,
>(input: T, subagentName?: string | null): T | unknown[] {
  return withOpenBoxActivityMetadata(input, {
    toolType: 'a2a',
    subagentName,
  });
}

export function buildLLMCompletionResponseBody(
  content: string,
  metadata: {
    model?: string;
    modelId?: string;
    provider?: string;
    usage?: LLMTokenUsage;
    responseBody?: unknown;
  } = {},
): string {
  const body = parseJsonRecord(metadata.responseBody);
  if (!Array.isArray(body.choices)) {
    body.choices = [
      {
        message: { content },
      },
    ];
  }
  if (metadata.model && typeof body.model !== 'string') {
    body.model = metadata.model;
  }
  if (metadata.modelId && !firstTrimmed(body.model_id)) {
    body.model_id = metadata.modelId;
  }
  if (metadata.provider && !firstTrimmed(body.provider)) {
    body.provider = metadata.provider;
  }
  if (metadata.provider && !firstTrimmed(body.model_provider)) {
    body.model_provider = metadata.provider;
  }
  const usage = normalizeUsage(metadata.usage);
  if (usage && Object.keys(objectRecord(body.usage)).length === 0) {
    body.usage = usage;
  }
  return JSON.stringify(body);
}

function buildLLMCompletionRequestBody(metadata: {
  model?: string;
  modelId?: string;
  provider?: string;
  requestBody?: unknown;
}): string | undefined {
  const body = parseJsonRecord(metadata.requestBody);
  if (metadata.model && typeof body.model !== 'string') {
    body.model = metadata.model;
  }
  if (metadata.modelId && !firstTrimmed(body.model_id)) {
    body.model_id = metadata.modelId;
  }
  if (metadata.provider && !firstTrimmed(body.provider)) {
    body.provider = metadata.provider;
  }
  if (metadata.provider && !firstTrimmed(body.model_provider)) {
    body.model_provider = metadata.provider;
  }
  return Object.keys(body).length > 0
    ? JSON.stringify(body)
    : stringifyBody(metadata.requestBody);
}

export function buildLLMCompletionSpan(
  input: LLMCompletionSpanInput,
): SpanData {
  const now = Date.now() * 1_000_000;
  const source = input.span ?? {};
  const sourceRecord = source as SpanData & {
    durationNs?: unknown;
    error?: unknown;
    parent_span_id?: string | null;
  };
  const spanError = errorDescription(sourceRecord.error);
  const rawStartTime = input.startTime ?? source.start_time;
  const rawEndTime = input.endTime ?? source.end_time;
  const sourceStartTime =
    typeof source.start_time === 'number'
      ? normalizeSpanTimestamp(source.start_time)
      : undefined;
  const sourceEndTime =
    typeof source.end_time === 'number'
      ? normalizeSpanTimestamp(source.end_time)
      : undefined;
  const startTime = normalizeSpanTimestamp(input.startTime) ?? sourceStartTime ?? now;
  const endTime = normalizeSpanTimestamp(input.endTime) ?? sourceEndTime ?? now;
  const explicitDurationNs = normalizeDurationNs(input.durationNs);
  const sourceDurationNs = normalizeDurationNs(
    sourceRecord.duration_ns ?? sourceRecord.durationNs,
  );
  const usefulSourceDurationNs =
    sourceDurationNs !== undefined && sourceDurationNs > 0
      ? sourceDurationNs
      : undefined;
  const derivedDurationNs =
    deriveDurationNsFromRawTimestamps(rawStartTime, rawEndTime) ??
    deriveDurationNs(startTime, endTime);
  const usage = normalizeUsage(input.usage);
  const inputTokens = toUsageInteger(
    usage?.input_tokens ?? usage?.prompt_tokens,
  );
  const outputTokens = toUsageInteger(
    usage?.output_tokens ?? usage?.completion_tokens,
  );
  const totalTokens = toUsageInteger(usage?.total_tokens);
  const cacheReadInputTokens = toUsageInteger(usage?.cache_read_input_tokens);
  const cacheCreationInputTokens = toUsageInteger(
    usage?.cache_creation_input_tokens,
  );
  const webSearchRequests = toUsageInteger(usage?.web_search_requests);
  const costUsd = toUsageNumber(usage?.cost_usd);
  const explicitProviderUrl =
    input.providerUrl ??
    source.http_url ??
    (typeof source.attributes?.['http.url'] === 'string'
      ? source.attributes['http.url']
      : undefined);
  const modelTelemetry = modelTelemetryFields(
    input.model,
    input.provider,
    explicitProviderUrl,
  );
  const httpUrl = explicitProviderUrl ?? providerUrlForLLM(modelTelemetry.provider);
  return stripServerComputedSemantic({
    ...source,
    span_id: source.span_id ?? hex(16),
    trace_id: source.trace_id ?? hex(32),
    parent_span_id: sourceRecord.parent_span_id ?? null,
    name: input.name ?? source.name ?? 'llm.chat.completion',
    kind: input.kind ?? source.kind ?? 'CLIENT',
    start_time: startTime,
    end_time: endTime,
    duration_ns:
      explicitDurationNs ??
      usefulSourceDurationNs ??
      derivedDurationNs ??
      sourceDurationNs ??
      0,
    span_type: 'function',
    stage: 'completed',
    status: spanStatusOrDefault(source.status, spanError),
    events: Array.isArray(source.events) ? source.events : [],
    error: spanError ?? null,
    attributes: {
      'gen_ai.system': input.system ?? 'openbox-sdk',
      ...(input.model ? { 'gen_ai.request.model': input.model } : {}),
      ...(input.model ? { 'gen_ai.response.model': input.model } : {}),
      ...(modelTelemetry.modelId ? { 'openbox.model.id': modelTelemetry.modelId } : {}),
      ...(modelTelemetry.provider ? { 'openbox.model.provider': modelTelemetry.provider } : {}),
      ...(inputTokens !== undefined
        ? { 'gen_ai.usage.input_tokens': inputTokens }
        : {}),
      ...(outputTokens !== undefined
        ? { 'gen_ai.usage.output_tokens': outputTokens }
        : {}),
      ...(totalTokens !== undefined
        ? { 'gen_ai.usage.total_tokens': totalTokens }
        : {}),
      ...(cacheReadInputTokens !== undefined
        ? {
            'gen_ai.usage.cache_read_input_tokens': cacheReadInputTokens,
            'openbox.usage.cache_read_input_tokens': cacheReadInputTokens,
          }
        : {}),
      ...(cacheCreationInputTokens !== undefined
        ? {
            'gen_ai.usage.cache_creation_input_tokens': cacheCreationInputTokens,
            'openbox.usage.cache_creation_input_tokens': cacheCreationInputTokens,
          }
        : {}),
      ...(webSearchRequests !== undefined
        ? {
            'gen_ai.usage.web_search_requests': webSearchRequests,
            'openbox.usage.web_search_requests': webSearchRequests,
            'openbox.web_search.requests': webSearchRequests,
          }
        : {}),
      ...(costUsd !== undefined
        ? { 'openbox.usage.cost_usd': costUsd, 'openbox.cost.usd': costUsd }
        : {}),
      'http.method': 'POST',
      'http.url': httpUrl,
      'openbox.span_type': 'function',
      ...(source.attributes ?? {}),
      ...(input.attributes ?? {}),
    },
    ...(input.model ? { model: input.model } : {}),
    ...(modelTelemetry.modelId ? { model_id: modelTelemetry.modelId } : {}),
    ...(modelTelemetry.provider
      ? { provider: modelTelemetry.provider, model_provider: modelTelemetry.provider }
      : {}),
    ...(inputTokens !== undefined ? { input_tokens: inputTokens } : {}),
    ...(outputTokens !== undefined ? { output_tokens: outputTokens } : {}),
    ...(totalTokens !== undefined ? { total_tokens: totalTokens } : {}),
    ...(cacheReadInputTokens !== undefined
      ? { cache_read_input_tokens: cacheReadInputTokens }
      : {}),
    ...(cacheCreationInputTokens !== undefined
      ? { cache_creation_input_tokens: cacheCreationInputTokens }
      : {}),
    ...(webSearchRequests !== undefined ? { web_search_requests: webSearchRequests } : {}),
    ...(costUsd !== undefined ? { cost_usd: costUsd } : {}),
    http_method: source.http_method ?? 'POST',
    http_url: httpUrl,
    request_body: buildLLMCompletionRequestBody({
      model: input.model,
      modelId: modelTelemetry.modelId,
      provider: modelTelemetry.provider,
      requestBody: input.requestBody ?? source.request_body,
    }),
    data: input.data ?? source.data,
    response_body: buildLLMCompletionResponseBody(input.content, {
      model: input.model,
      modelId: modelTelemetry.modelId,
      provider: modelTelemetry.provider,
      usage: input.usage,
      responseBody: input.responseBody ?? source.response_body,
    }),
  } as ObservableSpan) as unknown as SpanData;
}

/**
 * Build a single span for the given event. The gate attributes drive
 * Core's classifier and produce the behavior-trigger decision
 * (`file_read`, `internal`, `llm_completion`, `http_*`, ...). The span
 * is appended to the evaluate payload's `spans` array; without it,
 * behavior rules never match.
 *
 * `host` is the adapter name (for example `'cursor'` or
 * `'claude-code'`). It stamps the `module` field and `gen_ai.system`
 * so dashboards and behavior rules keyed on `gen_ai.system` can
 * distinguish traffic by origin.
 */
function buildSpanWithClassifierFields(
  host: string,
  type: SpanType,
  input: SpanInput,
): Record<string, unknown> {
  const b = base(input.stage, input.error);
  switch (type) {
    case 'llm':
      // The LLM classifier requires `http.method` of POST and an
      // `http.url` that matches a known LLM domain. IDE and agent
      // hosts abstract the underlying model call, so infer the closest
      // provider URL from the model and fall back to OpenAI-compatible.
      // See `span-reference.md`.
      const usage = normalizeUsage(input.usage);
      const inputTokens = toUsageInteger(
        usage?.input_tokens ?? usage?.prompt_tokens,
      );
      const outputTokens = toUsageInteger(
        usage?.output_tokens ?? usage?.completion_tokens,
      );
      const totalTokens = toUsageInteger(usage?.total_tokens);
      const cacheReadInputTokens = toUsageInteger(usage?.cache_read_input_tokens);
      const cacheCreationInputTokens = toUsageInteger(
        usage?.cache_creation_input_tokens,
      );
      const webSearchRequests = toUsageInteger(usage?.web_search_requests);
      const costUsd = toUsageNumber(usage?.cost_usd);
      const modelTelemetry = modelTelemetryFields(input.model, undefined, undefined);
      const llmHttpUrl = providerUrlForLLM(modelTelemetry.provider);
      const llmRequestBody = {
        ...(input.model ? { model: input.model } : {}),
        ...(modelTelemetry.modelId ? { model_id: modelTelemetry.modelId } : {}),
        ...(modelTelemetry.provider
          ? {
              provider: modelTelemetry.provider,
              model_provider: modelTelemetry.provider,
            }
          : {}),
        ...(input.prompt
          ? { messages: [{ role: 'user', content: input.prompt }] }
          : {}),
      };
      const llmResponseContent =
        typeof input.response === 'string' ? input.response : '';
      return {
        ...b,
        name: 'llm.chat.completion',
        span_type: 'function',
        hook_type: 'function_call',
        attributes: {
          'gen_ai.system': host,
          ...(input.model ? { 'gen_ai.request.model': input.model } : {}),
          ...(input.model ? { 'gen_ai.response.model': input.model } : {}),
          ...(modelTelemetry.modelId
            ? { 'openbox.model.id': modelTelemetry.modelId }
            : {}),
          ...(modelTelemetry.provider
            ? { 'openbox.model.provider': modelTelemetry.provider }
            : {}),
          ...(inputTokens !== undefined
            ? { 'gen_ai.usage.input_tokens': inputTokens }
            : {}),
          ...(outputTokens !== undefined
            ? { 'gen_ai.usage.output_tokens': outputTokens }
            : {}),
          ...(totalTokens !== undefined
            ? { 'gen_ai.usage.total_tokens': totalTokens }
            : {}),
          ...(cacheReadInputTokens !== undefined
            ? {
                'gen_ai.usage.cache_read_input_tokens': cacheReadInputTokens,
                'openbox.usage.cache_read_input_tokens': cacheReadInputTokens,
              }
            : {}),
          ...(cacheCreationInputTokens !== undefined
            ? {
                'gen_ai.usage.cache_creation_input_tokens': cacheCreationInputTokens,
                'openbox.usage.cache_creation_input_tokens': cacheCreationInputTokens,
              }
            : {}),
          ...(webSearchRequests !== undefined
            ? {
                'gen_ai.usage.web_search_requests': webSearchRequests,
                'openbox.usage.web_search_requests': webSearchRequests,
                'openbox.web_search.requests': webSearchRequests,
              }
            : {}),
          ...(costUsd !== undefined
            ? { 'openbox.usage.cost_usd': costUsd, 'openbox.cost.usd': costUsd }
            : {}),
          'http.method': 'POST',
          'http.url': llmHttpUrl,
          'openbox.span_type': 'function',
        },
        ...(input.model ? { model: input.model } : {}),
        ...(modelTelemetry.modelId ? { model_id: modelTelemetry.modelId } : {}),
        ...(modelTelemetry.provider
          ? { provider: modelTelemetry.provider, model_provider: modelTelemetry.provider }
          : {}),
        ...(inputTokens !== undefined ? { input_tokens: inputTokens } : {}),
        ...(outputTokens !== undefined ? { output_tokens: outputTokens } : {}),
        ...(totalTokens !== undefined ? { total_tokens: totalTokens } : {}),
        ...(cacheReadInputTokens !== undefined
          ? { cache_read_input_tokens: cacheReadInputTokens }
          : {}),
        ...(cacheCreationInputTokens !== undefined
          ? { cache_creation_input_tokens: cacheCreationInputTokens }
          : {}),
        ...(webSearchRequests !== undefined ? { web_search_requests: webSearchRequests } : {}),
        ...(costUsd !== undefined ? { cost_usd: costUsd } : {}),
        function: 'LLMCall',
        module: host,
        args: input,
        result: input.response ?? null,
        http_method: 'POST',
        http_url: llmHttpUrl,
        ...(Object.keys(llmRequestBody).length > 0
          ? { request_body: stringifyBody(llmRequestBody) }
          : {}),
        response_body: buildLLMCompletionResponseBody(llmResponseContent, {
          model: input.model,
          modelId: modelTelemetry.modelId,
          provider: modelTelemetry.provider,
          usage: input.usage,
        }),
      };
    case 'llm_embedding': {
      const usage = normalizeUsage(input.usage);
      const inputTokens = toUsageInteger(
        usage?.input_tokens ?? usage?.prompt_tokens,
      );
      const totalTokens = toUsageInteger(usage?.total_tokens ?? inputTokens);
      const costUsd = toUsageNumber(usage?.cost_usd);
      const modelTelemetry = modelTelemetryFields(input.model, undefined, undefined);
      const llmHttpUrl = providerUrlForLLM(modelTelemetry.provider).replace(
        /\/chat\/completions$/,
        '/embeddings',
      );
      return {
        ...b,
        name: 'openai.EMBEDDING.create',
        span_type: 'function',
        hook_type: 'function_call',
        attributes: {
          'gen_ai.system': host,
          ...(input.model ? { 'gen_ai.request.model': input.model } : {}),
          ...(modelTelemetry.modelId
            ? { 'openbox.model.id': modelTelemetry.modelId }
            : {}),
          ...(modelTelemetry.provider
            ? { 'openbox.model.provider': modelTelemetry.provider }
            : {}),
          ...(inputTokens !== undefined
            ? { 'gen_ai.usage.input_tokens': inputTokens }
            : {}),
          ...(totalTokens !== undefined
            ? { 'gen_ai.usage.total_tokens': totalTokens }
            : {}),
          ...(costUsd !== undefined
            ? { 'openbox.usage.cost_usd': costUsd, 'openbox.cost.usd': costUsd }
            : {}),
          'http.method': 'POST',
          'http.url': llmHttpUrl,
          'openbox.span_type': 'function',
        },
        ...(input.model ? { model: input.model } : {}),
        ...(modelTelemetry.modelId ? { model_id: modelTelemetry.modelId } : {}),
        ...(modelTelemetry.provider
          ? { provider: modelTelemetry.provider, model_provider: modelTelemetry.provider }
          : {}),
        ...(inputTokens !== undefined ? { input_tokens: inputTokens } : {}),
        ...(totalTokens !== undefined ? { total_tokens: totalTokens } : {}),
        ...(costUsd !== undefined ? { cost_usd: costUsd } : {}),
        function: 'Embedding',
        module: host,
        args: input,
        result: null,
        http_method: 'POST',
        http_url: llmHttpUrl,
        request_body: stringifyBody({
          ...(input.model ? { model: input.model } : {}),
          ...(input.prompt ? { input: input.prompt } : {}),
        }),
        response_body: null,
      };
    }
    case 'llm_tool_call': {
      const usage = normalizeUsage(input.usage);
      const inputTokens = toUsageInteger(
        usage?.input_tokens ?? usage?.prompt_tokens,
      );
      const outputTokens = toUsageInteger(
        usage?.output_tokens ?? usage?.completion_tokens,
      );
      const totalTokens = toUsageInteger(usage?.total_tokens);
      const costUsd = toUsageNumber(usage?.cost_usd);
      const modelTelemetry = modelTelemetryFields(input.model, undefined, undefined);
      const llmHttpUrl = providerUrlForLLM(modelTelemetry.provider);
      const toolName = input.tool_name ?? input.tool ?? 'tool_call';
      return {
        ...b,
        name: 'openai.TOOL.call',
        span_type: 'function',
        hook_type: 'function_call',
        attributes: {
          'gen_ai.system': host,
          ...(input.model ? { 'gen_ai.request.model': input.model } : {}),
          ...(modelTelemetry.modelId
            ? { 'openbox.model.id': modelTelemetry.modelId }
            : {}),
          ...(modelTelemetry.provider
            ? { 'openbox.model.provider': modelTelemetry.provider }
            : {}),
          ...(inputTokens !== undefined
            ? { 'gen_ai.usage.input_tokens': inputTokens }
            : {}),
          ...(outputTokens !== undefined
            ? { 'gen_ai.usage.output_tokens': outputTokens }
            : {}),
          ...(totalTokens !== undefined
            ? { 'gen_ai.usage.total_tokens': totalTokens }
            : {}),
          ...(costUsd !== undefined
            ? { 'openbox.usage.cost_usd': costUsd, 'openbox.cost.usd': costUsd }
            : {}),
          'http.method': 'POST',
          'http.url': llmHttpUrl,
          ...toolNameAttributes(input),
          'openbox.span_type': 'function',
        },
        ...(input.model ? { model: input.model } : {}),
        ...(modelTelemetry.modelId ? { model_id: modelTelemetry.modelId } : {}),
        ...(modelTelemetry.provider
          ? { provider: modelTelemetry.provider, model_provider: modelTelemetry.provider }
          : {}),
        ...(inputTokens !== undefined ? { input_tokens: inputTokens } : {}),
        ...(outputTokens !== undefined ? { output_tokens: outputTokens } : {}),
        ...(totalTokens !== undefined ? { total_tokens: totalTokens } : {}),
        ...(costUsd !== undefined ? { cost_usd: costUsd } : {}),
        function: `ToolCall:${toolName}`,
        module: host,
        args: input.tool_input ?? input,
        result: input.tool_output ?? null,
        http_method: 'POST',
        http_url: llmHttpUrl,
        request_body: stringifyBody({
          ...(input.model ? { model: input.model } : {}),
          tool_choice: String(toolName),
          tool_input: input.tool_input ?? {},
        }),
        response_body: stringifyBody({
          tool_calls: [{ name: toolName, arguments: input.tool_input ?? {} }],
        }),
      };
    }
    case 'file_read':
      return {
        ...b,
        name: 'file.read',
        kind: 'INTERNAL',
        span_type: 'file_io',
        hook_type: 'file_operation',
        attributes: {
          'file.path': input.file_path ?? '',
          'file.operation': 'read',
          ...toolNameAttributes(input),
          'openbox.span_type': 'file_io',
        },
        module: host,
        file_path: input.file_path ?? '',
        file_mode: 'r',
        file_operation: 'read',
      };
    case 'file_open':
      return {
        ...b,
        name: 'file.open',
        kind: 'INTERNAL',
        span_type: 'file_io',
        hook_type: 'file_operation',
        attributes: {
          'file.path': input.file_path ?? '',
          'file.operation': 'open',
          ...toolNameAttributes(input),
          'openbox.span_type': 'file_io',
        },
        module: host,
        file_path: input.file_path ?? '',
        file_mode: 'r',
        file_operation: 'open',
      };
    case 'file_write':
      return {
        ...b,
        name: 'file.write',
        kind: 'INTERNAL',
        span_type: 'file_io',
        hook_type: 'file_operation',
        attributes: {
          'file.path': input.file_path ?? '',
          'file.operation': 'write',
          ...toolNameAttributes(input),
          'openbox.span_type': 'file_io',
        },
        module: host,
        file_path: input.file_path ?? '',
        file_mode: 'w',
        file_operation: 'write',
      };
    case 'file_delete':
      return {
        ...b,
        name: 'file.delete',
        kind: 'INTERNAL',
        span_type: 'file_io',
        hook_type: 'file_operation',
        attributes: {
          'file.path': input.file_path ?? '',
          'file.operation': 'delete',
          ...toolNameAttributes(input),
          'openbox.span_type': 'file_io',
        },
        module: host,
        file_path: input.file_path ?? '',
        file_operation: 'delete',
      };
    case 'shell':
      // No `shell_execution` trigger exists; shell spans classify as
      // `internal` (see `behaviors.md`). To gate shells, create a
      // behavior rule with `--trigger internal --states internal`.
      return {
        ...b,
        name: 'ShellExecution',
        kind: 'INTERNAL',
        span_type: 'function',
        hook_type: 'function_call',
        attributes: {
          'shell.command': input.command ?? '',
          'shell.cwd': input.cwd ?? '',
          ...toolNameAttributes(input),
          'openbox.span_type': 'function',
        },
        function: 'ShellExecution',
        module: host,
        args: input,
        result: null,
      };
    case 'mcp':
      // Core classifies MCP calls from `mcp.method=callTool`.
      // Keep this transport-agnostic so MCP does not get counted as
      // provider LLM traffic merely because a host routes it through an LLM.
      const toolName = input.tool_name ?? input.tool ?? 'call';
      const mcp = mcpIdentity(input);
      return {
        ...b,
        name: `MCP ${mcp.method} ${mcp.operation}`,
        span_type: 'mcp_tool_call',
        hook_type: 'function_call',
        attributes: {
          'mcp.method': mcp.method,
          'mcp.operation': mcp.operation,
          'mcp.server_id': mcp.serverId,
          'mcp.input': input.tool_input ?? {},
          'openbox.span_type': 'mcp_tool_call',
          'openbox.tool.name': toolName,
          'tool.name': toolName,
          tool_name: toolName,
        },
        function: `mcp.${toolName}`,
        module: host,
        args: input,
        result: input.tool_output ?? null,
      };
    case 'http':
      // Outbound HTTP from `WebFetch`, `WebSearch`, or explicit
      // fetch tools. Core derives the HTTP semantic from the method,
      // which defaults to GET when the host does not surface one.
      const method = (input.method ?? 'GET').toUpperCase();
      const url = input.url ?? '';
      return {
        ...b,
        name: `${method} ${url}`,
        span_type: 'http',
        hook_type: 'http_request',
        attributes: {
          'http.method': method,
          'http.url': url,
          ...toolNameAttributes(input),
          'openbox.span_type': 'http',
        },
        http_method: method,
        http_url: url,
        request_body: null,
        response_body: null,
        request_headers: null,
        response_headers: null,
        http_status_code: null,
        function: 'HTTPCall',
        module: host,
        args: input,
        result: null,
      };
    case 'db':
      const dbSystem = input.db_system ?? input.system ?? 'postgresql';
      const dbOperation = (input.db_operation ?? input.operation ?? 'SELECT').toUpperCase();
      const dbResource =
        typeof (input as Record<string, unknown>).resource === 'string'
          ? (input as Record<string, string>).resource
          : typeof (input as Record<string, unknown>).table === 'string'
            ? (input as Record<string, string>).table
            : undefined;
      const dbStatement =
        input.db_statement ??
        input.statement ??
        input.query ??
        (dbResource ? `database resource ${dbResource}` : `${dbOperation} operation`);
      return {
        ...b,
        name: dbOperation,
        span_type: 'database',
        hook_type: 'db_query',
        attributes: {
          'db.system': dbSystem,
          'db.operation': dbOperation,
          'db.statement': dbStatement,
          ...toolNameAttributes(input),
          'openbox.span_type': 'database',
        },
        db_system: dbSystem,
        db_name: null,
        db_operation: dbOperation,
        db_statement: dbStatement,
        server_address: null,
        server_port: null,
        rowcount: null,
        function: 'DatabaseQuery',
        module: host,
        args: input,
        result: null,
      };
  }
}

export function buildSpan(
  host: string,
  type: SpanType,
  input: SpanInput,
): Record<string, unknown> {
  return stripServerComputedSemantic(buildSpanWithClassifierFields(host, type, input));
}
