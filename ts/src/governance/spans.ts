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
import { CANONICAL_SPAN } from '../core-client/generated/govern.js';
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
    status: { code: description ? CANONICAL_SPAN.statusCode.error : CANONICAL_SPAN.statusCode.unset, description: description ?? null },
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
  file_mode?: string;
  // Completed-stage byte counts (merged in by recordOpSpanPair). The canonical
  // file hooks surface the count as a `file.bytes` span attribute on read/write.
  bytes_read?: number;
  bytes_written?: number;
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
  request_body?: unknown;
  requestBody?: unknown;
  response_body?: unknown;
  responseBody?: unknown;
  request_headers?: unknown;
  requestHeaders?: unknown;
  response_headers?: unknown;
  responseHeaders?: unknown;
  http_status_code?: unknown;
  httpStatusCode?: unknown;
  db_system?: string;
  system?: string;
  db_operation?: string;
  operation?: string;
  db_statement?: string;
  statement?: string;
  query?: string;
  error?: unknown;
  data?: unknown;
  // Raw provider request/response captured at the HTTP client (OTel-style).
  // When present they are used verbatim instead of the synthesized bodies, so
  // the span carries the real wire payload (full messages, raw provider JSON).
  rawRequestBody?: unknown;
  rawResponseBody?: unknown;
  provider?: string;
  // Explicit wall-clock timing for spans whose caller knows real start/end (e.g.
  // assistant-output / captured LLM spans). Overrides base()'s now() default.
  startTime?: number;
  endTime?: number;
  durationNs?: number;
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
  requestHeaders?: unknown;
  responseHeaders?: unknown;
  httpStatusCode?: unknown;
  providerUrl?: string;
  startTime?: number;
  endTime?: number;
  durationNs?: number;
  attributes?: Record<string, unknown>;
  data?: unknown;
  // Raw provider request/response captured at the HTTP client (OTel-style),
  // used verbatim so the completed span mirrors the real wire payload.
  rawRequestBody?: unknown;
  rawResponseBody?: unknown;
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
  /* c8 ignore next -- defensive: every live caller already guards against undefined */
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
  /* c8 ignore next -- defensive: a truthy normalizedUsage always re-extracts ≥1 normalized field, so the empty→undefined arm is unreachable */
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
  /* c8 ignore next -- defensive: value is non-empty here and pre-trimmed by parseModelIdentifier */
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

// The SDK emits the inner span; Core wraps it in the outer envelope that
// carries duration_ms, error, span_type, verdict, metadata, merkle_*, etc.
// The reference inner llm_completion (POST) span does not repeat those envelope
// fields, nor the generic function/module/args/result debug fields, on the
// span. Drop them from CopilotKit POST spans so the inner span matches the
// reference structure. The real model/usage telemetry (top-level fields +
// gen_ai/openbox attributes) is intentionally kept — it is real (not
// fabricated) and the platform surfaces it; the leaner Python reference simply
// does not emit it. Only POST spans are affected; tool/internal spans keep
// their fields (the reference keeps them too).
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
  // Mapping is spec-driven (CANONICAL_SPAN.semanticType, from @spanContract).
  const sem = CANONICAL_SPAN.semanticType;
  const byMethod = sem.httpByMethod as Record<string, string>;
  const byOperation = sem.dbByOperation as Record<string, string>;
  const staticMap = sem.static as Record<string, string>;
  if (type === 'http') {
    const method = (input.method ?? 'GET').trim().toLowerCase();
    return byMethod[method] ?? sem.httpDefault;
  }
  if (type === 'db') {
    const operation = (
      input.db_operation ??
      input.operation ??
      'query'
    )
      .trim()
      .toLowerCase();
    return byOperation[operation] ?? sem.dbDefault;
  }
  return staticMap[type] ?? type;
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
  } else if (content) {
    const firstChoice = objectRecord(body.choices[0]);
    const message = objectRecord(firstChoice.message);
    if (typeof message.content !== 'string' || message.content.trim() === '') {
      body.choices = [
        {
          ...firstChoice,
          message: {
            ...message,
            content,
          },
        },
        ...body.choices.slice(1),
      ];
    }
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

function defaultLLMRequestHeaders(provider?: string): Record<string, string> {
  const normalizedProvider = provider?.toLowerCase() ?? '';
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (normalizedProvider.includes('anthropic')) {
    headers['x-api-key'] = CANONICAL_SPAN.redactedSentinel;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers.authorization = CANONICAL_SPAN.redactedSentinel;
  }
  return headers;
}

function defaultLLMResponseHeaders(provider?: string): Record<string, string> {
  const normalizedProvider = provider?.toLowerCase() ?? '';
  return {
    'content-type': 'application/json',
    ...(normalizedProvider.includes('openai')
      ? { 'openai-version': '2020-10-01' }
      : {}),
  };
}

function coerceHttpStatusCode(value: unknown): number | undefined {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : undefined;
  if (numeric === undefined || !Number.isFinite(numeric)) return undefined;
  return Math.trunc(numeric);
}

// Sensitive headers are ALWAYS redacted — there is no opt-out flag, mirroring
// the canonical Python SDK (_sanitize_headers), which unconditionally replaces
// the value with the literal `[REDACTED]`.
function sanitizeHeaderMap(value: unknown): Record<string, string> | undefined {
  const record = objectRecord(value);
  const entries = Object.entries(record).flatMap(([key, entry]) => {
    if (typeof entry !== 'string') return [];
    return [[key, sanitizeHeaderValue(key, entry)] as const];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

const REDACTED = CANONICAL_SPAN.redactedSentinel;

// Canonical sensitive set, from the generated contract (CANONICAL_SPAN) — exact
// keys only, no substring heuristics, so non-secret headers like
// x-ratelimit-*-tokens keep their real values like the canonical SDK.
const SENSITIVE_HEADERS = new Set<string>(CANONICAL_SPAN.sensitiveHeaders);

function sanitizeHeaderValue(key: string, value: string): string {
  return SENSITIVE_HEADERS.has(key.toLowerCase()) ? REDACTED : value;
}

function headerMapOrNull(value: unknown): Record<string, string> | null {
  return sanitizeHeaderMap(value) ?? null;
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
      const llmStage =
        input.stage ??
        (input.response !== undefined || input.usage !== undefined
          ? 'completed'
          : 'started');
      const llmBase = llmStage === input.stage ? b : base(llmStage, input.error);
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
      const modelTelemetry = modelTelemetryFields(
        input.model,
        undefined,
        firstTrimmed(input.url),
      );
      // Prefer the real captured request URL over a provider URL derived from
      // the model, so the span carries the actual endpoint that was called.
      const llmHttpUrl =
        firstTrimmed(input.url) ?? providerUrlForLLM(modelTelemetry.provider);
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
      const llmRequestBodyString =
        input.rawRequestBody !== undefined
          ? stringifyBody(input.rawRequestBody)
          : buildLLMCompletionRequestBody({
              model: input.model,
              modelId: modelTelemetry.modelId,
              provider: modelTelemetry.provider,
              requestBody: input.request_body ?? input.requestBody ?? llmRequestBody,
            });
      const llmResponseContent =
        typeof input.response === 'string' ? input.response : '';
      const llmRequestHeaders =
        input.request_headers ??
        input.requestHeaders ??
        defaultLLMRequestHeaders(modelTelemetry.provider);
      const llmHttpStatusCode = coerceHttpStatusCode(
        input.http_status_code ??
          input.httpStatusCode ??
          (llmStage === 'completed' ? 200 : undefined),
      );
      const llmResponseHeaders =
        sanitizeHeaderMap(input.response_headers ?? input.responseHeaders) ??
        (llmHttpStatusCode !== undefined
          ? defaultLLMResponseHeaders(modelTelemetry.provider)
          : undefined);
      return {
        ...llmBase,
        name: 'POST',
        span_type: 'function',
        hook_type: 'http_request',
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
          ...(llmHttpStatusCode !== undefined
            ? { 'http.status_code': llmHttpStatusCode }
            : {}),
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
        ...(llmStage === 'completed' &&
        typeof llmBase.duration_ns === 'number' &&
        Number.isFinite(llmBase.duration_ns)
          ? { duration_ms: llmBase.duration_ns / 1_000_000 }
          : {}),
        function: 'LLMCall',
        module: host,
        args: input,
        result: input.response ?? null,
        http_method: 'POST',
        http_url: llmHttpUrl,
        ...(llmRequestBodyString ? { request_body: llmRequestBodyString } : {}),
        request_headers:
          sanitizeHeaderMap(llmRequestHeaders) ??
          defaultLLMRequestHeaders(modelTelemetry.provider),
        ...(llmResponseHeaders ? { response_headers: llmResponseHeaders } : {}),
        ...(llmHttpStatusCode !== undefined
          ? { http_status_code: llmHttpStatusCode }
          : {}),
        ...(llmStage === 'completed'
          ? {
              response_body:
                input.rawResponseBody !== undefined
                  ? stringifyBody(input.rawResponseBody)
                  : buildLLMCompletionResponseBody(llmResponseContent, {
                      model: input.model,
                      modelId: modelTelemetry.modelId,
                      provider: modelTelemetry.provider,
                      usage: input.usage,
                      responseBody: input.response_body ?? input.responseBody,
                    }),
            }
          : {}),
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
      const llmToolStage = input.stage ?? 'completed';
      const llmToolBase =
        llmToolStage === input.stage ? b : base(llmToolStage, input.error);
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
        ...llmToolBase,
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
        ...(llmToolStage === 'completed'
          ? {
              response_body: stringifyBody(
                input.tool_output === undefined
                  ? { tool_calls: [{ name: toolName, arguments: input.tool_input ?? {} }] }
                  : { tool_output: input.tool_output },
              ),
            }
          : {}),
      };
    }
    case 'file_read':
      return {
        ...b,
        name: 'file.read',
        kind: CANONICAL_SPAN.spanKind.file_operation,
        span_type: 'file_io',
        hook_type: 'file_operation',
        // Canonical read span sets `file.bytes` (the byte count) once known — i.e.
        // on the completed stage (file_governance_hooks.py:TracedFile.read L178).
        attributes: {
          'file.path': input.file_path ?? '',
          'file.operation': 'read',
          ...(typeof input.bytes_read === 'number'
            ? { 'file.bytes': input.bytes_read }
            : {}),
          ...toolNameAttributes(input),
          'openbox.span_type': 'file_io',
        },
        module: host,
        file_path: input.file_path ?? '',
        file_mode: (input.file_mode as string | undefined) ?? 'r',
        file_operation: 'read',
      };
    case 'file_open':
      // Canonical (file_governance_hooks.py:traced_open + TracedFile.close): the
      // open span is held across the file's life and ends as the 'close' completed
      // stage — it KEEPS the OTel span name "file.open" (verified against the real
      // reference); the close carries cumulative bytes_read/bytes_written +
      // operations[] at root (merged by recordOpSpanPair). The cumulative
      // file.total_bytes_* live on the PARENT span in the reference, not here.
      return {
        ...b,
        name: 'file.open',
        kind: CANONICAL_SPAN.spanKind.file_operation,
        span_type: 'file_io',
        hook_type: 'file_operation',
        attributes: {
          'file.path': input.file_path ?? '',
          'file.mode': (input.file_mode as string | undefined) ?? 'r',
          'file.operation': 'open',
          ...toolNameAttributes(input),
          'openbox.span_type': 'file_io',
        },
        module: host,
        file_path: input.file_path ?? '',
        file_mode: (input.file_mode as string | undefined) ?? 'r',
        file_operation: 'open',
      };
    case 'file_write':
      return {
        ...b,
        name: 'file.write',
        kind: CANONICAL_SPAN.spanKind.file_operation,
        span_type: 'file_io',
        hook_type: 'file_operation',
        // Canonical write span sets `file.bytes` (the byte count) once known — i.e.
        // on the completed stage (file_governance_hooks.py:TracedFile.write L229).
        attributes: {
          'file.path': input.file_path ?? '',
          'file.operation': 'write',
          ...(typeof input.bytes_written === 'number'
            ? { 'file.bytes': input.bytes_written }
            : {}),
          ...toolNameAttributes(input),
          'openbox.span_type': 'file_io',
        },
        module: host,
        file_path: input.file_path ?? '',
        file_mode: (input.file_mode as string | undefined) ?? 'w',
        file_operation: 'write',
      };
    case 'file_delete':
      return {
        ...b,
        name: 'file.delete',
        kind: CANONICAL_SPAN.spanKind.file_operation,
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
        kind: CANONICAL_SPAN.spanKind.function_call,
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
      const requestBody =
        input.request_body ??
        input.requestBody ??
        input.tool_input ??
        input.data ??
        null;
      const responseBody =
        input.response_body ??
        input.responseBody ??
        input.tool_output ??
        null;
      const requestHeaders =
        input.request_headers ?? input.requestHeaders ?? null;
      const responseHeaders =
        input.response_headers ?? input.responseHeaders ?? null;
      const httpStatusCode = input.http_status_code ?? input.httpStatusCode ?? null;
      return {
        ...b,
        // Canonical _build_http_span_data names the span `span.name or "HTTP
        // {method}"`; this synthetic tool span has no OTel name, so use the
        // canonical fallback (NOT "{method} {url}", which appended the URL).
        name: `HTTP ${method}`,
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
        request_body: requestBody === null ? null : stringifyBody(requestBody),
        response_body: responseBody === null ? null : stringifyBody(responseBody),
        request_headers:
          requestHeaders === null ? null : headerMapOrNull(requestHeaders),
        response_headers:
          responseHeaders === null ? null : headerMapOrNull(responseHeaders),
        http_status_code: httpStatusCode,
        function: 'HTTPCall',
        module: host,
        args: input,
        result: input.tool_output ?? null,
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
        // Honor connection metadata on BOTH stages (canonical db hooks set
        // db_name/server_address/server_port on started + completed). Falls back
        // to null when unknown (e.g. sqlite has no server endpoint).
        db_name:
          ((input as Record<string, unknown>).db_name as
            | string
            | null
            | undefined) ?? null,
        db_operation: dbOperation,
        db_statement: dbStatement,
        server_address:
          ((input as Record<string, unknown>).server_address as
            | string
            | null
            | undefined) ?? null,
        server_port:
          ((input as Record<string, unknown>).server_port as
            | number
            | null
            | undefined) ?? null,
        rowcount: null,
        function: 'DatabaseQuery',
        module: host,
        args: input,
        result: null,
      };
  }
}

// Canonical langgraph-py span field sets, per hook_type. The SDK's shared
// builder synthesizes a richer SUPERSET (span_type, openbox.*/gen_ai.* attrs,
// function/args/result/module on non-function_call hooks, LLM token/cost
// telemetry). `canonicalizeSpan` projects every built span down to exactly the
// fields the canonical Python hooks emit (_build_{file,http,db}_span_data and
// tracing.py), so EVERY host emits the byte-identical 1:1 langgraph shape — no
// superset. An LLM provider call (hook_type 'http_request') collapses to a plain
// http_request span because the usage/model fields aren't in the allow-list.
const CANONICAL_ENVELOPE_KEYS = [
  'span_id', 'trace_id', 'parent_span_id', 'name', 'kind', 'stage',
  'start_time', 'end_time', 'duration_ns', 'attributes', 'status', 'events',
  'hook_type', 'error',
] as const;
const CANONICAL_KEYS_BY_HOOK: Record<string, readonly string[]> = {
  file_operation: [
    'file_path', 'file_mode', 'file_operation',
    'data', 'bytes_read', 'bytes_written', 'lines_count', 'operations',
    'file_total_bytes_read', 'file_total_bytes_written',
  ],
  http_request: [
    'http_method', 'http_url', 'request_body', 'request_headers',
    'response_body', 'response_headers', 'http_status_code',
  ],
  db_query: [
    'db_system', 'db_name', 'db_operation', 'db_statement',
    'server_address', 'server_port', 'rowcount',
  ],
  function_call: ['function', 'module', 'args', 'result'],
};

export function canonicalizeSpan(span: Record<string, unknown>): Record<string, unknown> {
  const hook = typeof span.hook_type === 'string' ? span.hook_type : '';
  const allowed = new Set<string>([
    ...CANONICAL_ENVELOPE_KEYS,
    ...(CANONICAL_KEYS_BY_HOOK[hook] ?? []),
  ]);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(span)) {
    if (allowed.has(key)) out[key] = span[key];
  }
  // Canonical attributes are the OTel-native span attributes only; the SDK's
  // synthetic openbox.*/gen_ai.* telemetry keys are not part of the wire shape.
  const attrs = out.attributes;
  if (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) {
    out.attributes = Object.fromEntries(
      Object.entries(attrs as Record<string, unknown>).filter(
        ([key]) => !key.startsWith('openbox.') && !key.startsWith('gen_ai.'),
      ),
    );
  }
  // Canonical file.open carries ONLY {file.path, file.mode} as attributes —
  // file.operation lives at the root (file_operation), not as an attribute.
  if (
    span.name === 'file.open' &&
    out.attributes &&
    typeof out.attributes === 'object' &&
    !Array.isArray(out.attributes)
  ) {
    delete (out.attributes as Record<string, unknown>)['file.operation'];
  }
  // Canonical db span name falls back to "{db_operation} {db_system}" when the
  // OTel span is unnamed (_build_db_span_data).
  if (
    hook === 'db_query' &&
    typeof out.db_operation === 'string' &&
    typeof out.db_system === 'string'
  ) {
    out.name = `${out.db_operation} ${out.db_system}`;
  }
  return out;
}

export function buildSpan(
  host: string,
  type: SpanType,
  input: SpanInput,
): Record<string, unknown> {
  const built = buildSpanWithClassifierFields(host, type, input);
  // Canonical: function_call sub-op spans are INTERNAL (tracing.py). The shared
  // base() defaults kind:'CLIENT', which several function_call cases (embedding,
  // tool_call, mcp) inherited — correct it centrally so the span kind always
  // matches its hook_type for every host.
  const span =
    built.hook_type === 'function_call' &&
    built.kind !== CANONICAL_SPAN.spanKind.function_call
      ? { ...built, kind: CANONICAL_SPAN.spanKind.function_call }
      : built;
  const canonical = canonicalizeSpan(
    stripServerComputedSemantic(
      input.data !== undefined && span.data === undefined
        ? { ...span, data: input.data }
        : span,
    ),
  );
  return applyExplicitTiming(canonical, input);
}

// Override base()'s now() timing when the caller supplies real wall-clock (only
// completed spans carry end_time/duration_ns, matching the canonical hooks).
function applyExplicitTiming(
  span: Record<string, unknown>,
  input: SpanInput,
): Record<string, unknown> {
  const startNs = normalizeSpanTimestamp(input.startTime);
  const endNs = normalizeSpanTimestamp(input.endTime);
  // Derive duration from the RAW (pre-scaled) timestamps so ms inputs are
  // subtracted before the ×1e6 scale — nanosecond subtraction would exceed JS's
  // safe-integer range and lose precision.
  const durNs =
    normalizeDurationNs(input.durationNs) ??
    deriveDurationNsFromRawTimestamps(input.startTime, input.endTime);
  if (startNs === undefined && endNs === undefined && durNs === undefined) {
    return span;
  }
  const out = { ...span };
  if (startNs !== undefined) out.start_time = startNs;
  if (span.stage === 'completed') {
    if (endNs !== undefined) out.end_time = endNs;
    if (durNs !== undefined) out.duration_ns = durNs;
  }
  return out;
}
