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
  status: { code: string; description: null };
  events: never[];
  error: null;
}

function base(): SpanBase {
  return {
    span_id: hex(16),
    trace_id: hex(32),
    parent_span_id: null,
    kind: 'CLIENT',
    span_type: 'function',
    stage: 'started',
    start_time: Date.now() * 1_000_000,
    end_time: null,
    duration_ns: null,
    status: { code: 'OK', description: null },
    events: [],
    error: null,
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
  prompt?: string;
  response?: string;
  model?: string;
  usage?: LLMTokenUsage;
  file_path?: string;
  command?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_output?: unknown;
  url?: string;
  method?: string;
  db_system?: string;
  db_operation?: string;
  db_statement?: string;
}

export interface LLMCompletionSpanInput {
  content: string;
  span?: Partial<SpanData>;
  name?: string;
  kind?: string;
  system?: string;
  model?: string;
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
}

type JsonRecord = Record<string, unknown>;

type ObservableSpan = SpanData & {
  span_type?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
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

function normalizeUsage(usage?: LLMTokenUsage): JsonRecord | undefined {
  if (!usage) return undefined;
  const promptTokens = toPositiveInteger(
    usage.promptTokens ?? usage.inputTokens,
  );
  const completionTokens = toPositiveInteger(
    usage.completionTokens ?? usage.outputTokens,
  );
  const totalTokens = toPositiveInteger(usage.totalTokens);
  const normalized: JsonRecord = {};
  if (promptTokens !== undefined) {
    normalized.prompt_tokens = promptTokens;
    normalized.input_tokens = promptTokens;
  }
  if (completionTokens !== undefined) {
    normalized.completion_tokens = completionTokens;
    normalized.output_tokens = completionTokens;
  }
  if (totalTokens !== undefined) normalized.total_tokens = totalTokens;
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function buildLLMCompletionResponseBody(
  content: string,
  metadata: {
    model?: string;
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
  const usage = normalizeUsage(metadata.usage);
  if (usage && Object.keys(objectRecord(body.usage)).length === 0) {
    body.usage = usage;
  }
  return JSON.stringify(body);
}

export function buildLLMCompletionSpan(
  input: LLMCompletionSpanInput,
): SpanData {
  const now = Date.now();
  const source = input.span ?? {};
  const usage = normalizeUsage(input.usage);
  const inputTokens = toPositiveInteger(
    usage?.input_tokens ?? usage?.prompt_tokens,
  );
  const outputTokens = toPositiveInteger(
    usage?.output_tokens ?? usage?.completion_tokens,
  );
  const httpUrl =
    input.providerUrl ??
    source.http_url ??
    (typeof source.attributes?.['http.url'] === 'string'
      ? source.attributes['http.url']
      : 'https://api.openai.com/v1/chat/completions');
  return {
    ...source,
    span_id: source.span_id ?? hex(16),
    trace_id: source.trace_id ?? hex(32),
    name: input.name ?? source.name ?? 'llm.chat.completion',
    kind: input.kind ?? source.kind ?? 'CLIENT',
    start_time: input.startTime ?? source.start_time ?? now,
    end_time: input.endTime ?? source.end_time ?? now,
    duration_ns: input.durationNs ?? source.duration_ns ?? 0,
    span_type: 'function',
    stage: 'completed',
    semantic_type: 'llm_completion',
    attributes: {
      'gen_ai.system': input.system ?? 'openbox-sdk',
      ...(input.model ? { 'gen_ai.request.model': input.model } : {}),
      ...(input.model ? { 'gen_ai.response.model': input.model } : {}),
      ...(inputTokens !== undefined
        ? { 'gen_ai.usage.input_tokens': inputTokens }
        : {}),
      ...(outputTokens !== undefined
        ? { 'gen_ai.usage.output_tokens': outputTokens }
        : {}),
      'http.method': 'POST',
      'http.url': httpUrl,
      'openbox.semantic_type': 'llm_completion',
      'openbox.span_type': 'function',
      ...(source.attributes ?? {}),
      ...(input.attributes ?? {}),
    },
    ...(input.model ? { model: input.model } : {}),
    ...(inputTokens !== undefined ? { input_tokens: inputTokens } : {}),
    ...(outputTokens !== undefined ? { output_tokens: outputTokens } : {}),
    http_method: source.http_method ?? 'POST',
    http_url: httpUrl,
    request_body:
      stringifyBody(input.requestBody) ?? source.request_body ?? undefined,
    data: input.data ?? source.data,
    response_body: buildLLMCompletionResponseBody(input.content, {
      model: input.model,
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
  const b = base();
  switch (type) {
    case 'llm':
      // The LLM classifier requires `http.method` of POST and an
      // `http.url` that matches a known LLM domain. IDE and agent
      // hosts abstract the underlying model call, so tag a generic
      // OpenAI-shaped URL. See `span-reference.md`.
      const usage = normalizeUsage(input.usage);
      const inputTokens = toPositiveInteger(
        usage?.input_tokens ?? usage?.prompt_tokens,
      );
      const outputTokens = toPositiveInteger(
        usage?.output_tokens ?? usage?.completion_tokens,
      );
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
          ...(inputTokens !== undefined
            ? { 'gen_ai.usage.input_tokens': inputTokens }
            : {}),
          ...(outputTokens !== undefined
            ? { 'gen_ai.usage.output_tokens': outputTokens }
            : {}),
          'http.method': 'POST',
          'http.url': 'https://api.openai.com/v1/chat/completions',
          'openbox.semantic_type': 'llm_completion',
          'openbox.span_type': 'function',
        },
        ...(input.model ? { model: input.model } : {}),
        ...(inputTokens !== undefined ? { input_tokens: inputTokens } : {}),
        ...(outputTokens !== undefined ? { output_tokens: outputTokens } : {}),
        function: 'LLMCall',
        module: host,
        args: input,
        result: input.response ?? null,
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
          'openbox.semantic_type': 'internal',
          'openbox.span_type': 'function',
        },
        function: 'ShellExecution',
        module: host,
        args: input,
        result: null,
      };
    case 'mcp':
      // Behavior rules use the generic tool-call semantic type; platform
      // observability uses the MCP span type and tool name fields.
      return {
        ...b,
        name: `tool.${input.tool_name ?? 'call'}`,
        span_type: 'mcp_tool_call',
        hook_type: 'function_call',
        semantic_type: 'llm_tool_call',
        attributes: {
          'gen_ai.system': 'mcp',
          'http.method': 'POST',
          'http.url': 'https://api.openai.com/v1/chat/completions',
          'openbox.semantic_type': 'llm_tool_call',
          'openbox.span_type': 'mcp_tool_call',
          'openbox.tool.name': input.tool_name ?? 'call',
          'tool.name': input.tool_name ?? 'call',
          tool_name: input.tool_name ?? 'call',
        },
        function: `mcp.${input.tool_name ?? 'call'}`,
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
      const dbSystem = input.db_system ?? 'postgresql';
      const dbOperation = (input.db_operation ?? 'SELECT').toUpperCase();
      const dbStatement = input.db_statement ?? `${dbOperation} statement`;
      return {
        ...b,
        name: `${dbOperation} ${dbStatement.split(' ').slice(0, 3).join(' ')}`,
        span_type: 'database',
        hook_type: 'db_query',
        semantic_type: `database_${dbOperation.toLowerCase()}`,
        attributes: {
          'db.system': dbSystem,
          'db.operation': dbOperation,
          'db.statement': dbStatement,
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
