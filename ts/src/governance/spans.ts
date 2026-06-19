// Span builder for governance evaluate payloads. Shared across every
// host adapter so behavior rules see the same span shapes regardless
// of which host invoked the action.
//
// Behavior rules match spans by `semantic_type` and classifier gate
// attributes (`file.path`, `http.method`, `db.system`,
// `gen_ai.system`, `shell.command`); see
// `skill/references/span-reference.md`. Activity type alone does not
// trigger a behavior rule. Without a span that carries the right
// gate attributes the request falls through to default-allow.
//
// The `host` parameter on `buildSpan()` populates the `module` field
// and `gen_ai.system` for LLM spans so backend telemetry can
// distinguish traffic by originating adapter.

import type { SpanData } from '../core-client/index.js';

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
    status: { code: description ? 'ERROR' : 'UNSET', description: description ?? null },
    events: [],
    error: description ?? null,
  };
}

export type SpanType =
  | 'llm'
  | 'file_read'
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

function toPositiveNumber(value: unknown): number | undefined {
  const numberValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : undefined;
  if (numberValue === undefined || !Number.isFinite(numberValue) || numberValue <= 0)
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

export function llmTokenUsageFromRecord(value: unknown): LLMTokenUsage | undefined {
  const record = objectRecord(value);
  const promptTokens = toPositiveInteger(
    record.promptTokens ??
      record.prompt_tokens ??
      record.inputTokens ??
      record.input_tokens ??
      record.promptTokenCount ??
      record.prompt_token_count ??
      record.inputTokenCount ??
      record.input_token_count,
  );
  const completionTokens = toPositiveInteger(
    record.completionTokens ??
      record.completion_tokens ??
      record.outputTokens ??
      record.output_tokens ??
      record.candidatesTokenCount ??
      record.candidates_token_count ??
      record.outputTokenCount ??
      record.output_token_count ??
      record.responseTokenCount ??
      record.response_token_count,
  );
  const totalTokens = toPositiveInteger(
    record.totalTokens ??
      record.total_tokens ??
      record.totalTokenCount ??
      record.total_token_count,
  );
  const cacheReadInputTokens = toPositiveInteger(
    record.cacheReadInputTokens ?? record.cache_read_input_tokens,
  );
  const cacheCreationInputTokens = toPositiveInteger(
    record.cacheCreationInputTokens ?? record.cache_creation_input_tokens,
  );
  const webSearchRequests = toPositiveInteger(
    record.webSearchRequests ?? record.web_search_requests,
  );
  const costUsd = toPositiveNumber(record.costUSD ?? record.costUsd ?? record.cost_usd);
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

function normalizeUsage(usage?: LLMTokenUsage): JsonRecord | undefined {
  const normalizedUsage = llmTokenUsageFromRecord(usage);
  if (!normalizedUsage) return undefined;
  const promptTokens = toPositiveInteger(
    normalizedUsage.promptTokens ?? normalizedUsage.inputTokens,
  );
  const completionTokens = toPositiveInteger(
    normalizedUsage.completionTokens ?? normalizedUsage.outputTokens,
  );
  const totalTokens = toPositiveInteger(normalizedUsage.totalTokens);
  const cacheReadInputTokens = toPositiveInteger(
    normalizedUsage.cacheReadInputTokens ?? normalizedUsage.cache_read_input_tokens,
  );
  const cacheCreationInputTokens = toPositiveInteger(
    normalizedUsage.cacheCreationInputTokens ?? normalizedUsage.cache_creation_input_tokens,
  );
  const webSearchRequests = toPositiveInteger(
    normalizedUsage.webSearchRequests ?? normalizedUsage.web_search_requests,
  );
  const costUsd = toPositiveNumber(
    normalizedUsage.costUSD ?? normalizedUsage.costUsd ?? normalizedUsage.cost_usd,
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
  const sourceStartTime =
    typeof source.start_time === 'number'
      ? normalizeSpanTimestamp(source.start_time)
      : undefined;
  const sourceEndTime =
    typeof source.end_time === 'number'
      ? normalizeSpanTimestamp(source.end_time)
      : undefined;
  const usage = normalizeUsage(input.usage);
  const inputTokens = toPositiveInteger(
    usage?.input_tokens ?? usage?.prompt_tokens,
  );
  const outputTokens = toPositiveInteger(
    usage?.output_tokens ?? usage?.completion_tokens,
  );
  const totalTokens = toPositiveInteger(usage?.total_tokens);
  const cacheReadInputTokens = toPositiveInteger(usage?.cache_read_input_tokens);
  const cacheCreationInputTokens = toPositiveInteger(
    usage?.cache_creation_input_tokens,
  );
  const webSearchRequests = toPositiveInteger(usage?.web_search_requests);
  const costUsd = toPositiveNumber(usage?.cost_usd);
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
  return {
    ...source,
    span_id: source.span_id ?? hex(16),
    trace_id: source.trace_id ?? hex(32),
    name: input.name ?? source.name ?? 'llm.chat.completion',
    kind: input.kind ?? source.kind ?? 'CLIENT',
    start_time: normalizeSpanTimestamp(input.startTime) ?? sourceStartTime ?? now,
    end_time: normalizeSpanTimestamp(input.endTime) ?? sourceEndTime ?? now,
    duration_ns: input.durationNs ?? source.duration_ns ?? 0,
    span_type: 'function',
    stage: 'completed',
    semantic_type: 'llm_completion',
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
      'openbox.semantic_type': 'llm_completion',
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
  } as ObservableSpan;
}

/**
 * Build a single span for the given event. The `semantic_type` and
 * gate attributes drive the classifier's behavior-trigger decision
 * (`file_read`, `internal`, `llm_completion`, `http_*`, ...). The
 * span is appended to the evaluate payload's `spans` array;
 * without it, behavior rules never match.
 *
 * `host` is the adapter name (for example `'cursor'` or
 * `'claude-code'`). It stamps the `module` field and `gen_ai.system`
 * so dashboards and behavior rules keyed on `gen_ai.system` can
 * distinguish traffic by origin.
 */
export function buildSpan(
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
      const inputTokens = toPositiveInteger(
        usage?.input_tokens ?? usage?.prompt_tokens,
      );
      const outputTokens = toPositiveInteger(
        usage?.output_tokens ?? usage?.completion_tokens,
      );
      const totalTokens = toPositiveInteger(usage?.total_tokens);
      const cacheReadInputTokens = toPositiveInteger(usage?.cache_read_input_tokens);
      const cacheCreationInputTokens = toPositiveInteger(
        usage?.cache_creation_input_tokens,
      );
      const webSearchRequests = toPositiveInteger(usage?.web_search_requests);
      const costUsd = toPositiveNumber(usage?.cost_usd);
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
        semantic_type: 'llm_completion',
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
          'openbox.semantic_type': 'llm_completion',
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
    case 'file_read':
      return {
        ...b,
        name: 'file.read',
        kind: 'INTERNAL',
        span_type: 'file_io',
        hook_type: 'file_operation',
        semantic_type: 'file_read',
        attributes: {
          'file.path': input.file_path ?? '',
          'file.operation': 'read',
          ...toolNameAttributes(input),
          'openbox.semantic_type': 'file_read',
          'openbox.span_type': 'file_io',
        },
        module: host,
        file_path: input.file_path ?? '',
        file_mode: 'r',
        file_operation: 'read',
      };
    case 'file_write':
      return {
        ...b,
        name: 'file.write',
        kind: 'INTERNAL',
        span_type: 'file_io',
        hook_type: 'file_operation',
        semantic_type: 'file_write',
        attributes: {
          'file.path': input.file_path ?? '',
          'file.operation': 'write',
          ...toolNameAttributes(input),
          'openbox.semantic_type': 'file_write',
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
        semantic_type: 'file_delete',
        attributes: {
          'file.path': input.file_path ?? '',
          'file.operation': 'delete',
          ...toolNameAttributes(input),
          'openbox.semantic_type': 'file_delete',
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
        semantic_type: 'internal',
        attributes: {
          'shell.command': input.command ?? '',
          'shell.cwd': input.cwd ?? '',
          ...toolNameAttributes(input),
          'openbox.semantic_type': 'internal',
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
        semantic_type: 'mcp_tool_call',
        attributes: {
          'mcp.method': mcp.method,
          'mcp.operation': mcp.operation,
          'mcp.server_id': mcp.serverId,
          'mcp.input': input.tool_input ?? {},
          'openbox.semantic_type': 'mcp_tool_call',
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
      // fetch tools. `semantic_type` matches the method; defaults
      // to GET when the host does not surface one.
      const method = (input.method ?? 'GET').toUpperCase();
      const url = input.url ?? '';
      return {
        ...b,
        name: `${method} ${url}`,
        span_type: 'http',
        hook_type: 'http_request',
        semantic_type: `http_${method.toLowerCase()}`,
        attributes: {
          'http.method': method,
          'http.url': url,
          ...toolNameAttributes(input),
          'openbox.semantic_type': `http_${method.toLowerCase()}`,
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
      const dbStatement =
        input.db_statement ?? input.statement ?? input.query ?? `${dbOperation} statement`;
      return {
        ...b,
        name: dbOperation,
        span_type: 'database',
        hook_type: 'db_query',
        semantic_type: `database_${dbOperation.toLowerCase()}`,
        attributes: {
          'db.system': dbSystem,
          'db.operation': dbOperation,
          'db.statement': dbStatement,
          ...toolNameAttributes(input),
          'openbox.semantic_type': `database_${dbOperation.toLowerCase()}`,
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
