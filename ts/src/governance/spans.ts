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
  | 'http';

export interface SpanInput {
  prompt?: string;
  response?: string;
  file_path?: string;
  command?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_output?: unknown;
  url?: string;
  method?: string;
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
      return {
        ...b,
        name: 'llm.chat.completion',
        hook_type: 'function_call',
        semantic_type: 'llm_completion',
        attributes: {
          'gen_ai.system': host,
          'http.method': 'POST',
          'http.url': 'https://api.openai.com/v1/chat/completions',
        },
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
        hook_type: 'file_operation',
        semantic_type: 'file_read',
        attributes: {
          'file.path': input.file_path ?? '',
          'file.operation': 'read',
        },
        file_path: input.file_path ?? '',
        file_mode: 'r',
        file_operation: 'read',
      };
    case 'file_write':
      return {
        ...b,
        name: 'file.write',
        kind: 'INTERNAL',
        hook_type: 'file_operation',
        semantic_type: 'file_write',
        attributes: {
          'file.path': input.file_path ?? '',
          'file.operation': 'write',
        },
        file_path: input.file_path ?? '',
        file_mode: 'w',
        file_operation: 'write',
      };
    case 'file_delete':
      return {
        ...b,
        name: 'file.delete',
        kind: 'INTERNAL',
        hook_type: 'file_operation',
        semantic_type: 'file_delete',
        attributes: {
          'file.path': input.file_path ?? '',
          'file.operation': 'delete',
        },
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
        hook_type: 'function_call',
        semantic_type: 'internal',
        attributes: {
          'shell.command': input.command ?? '',
          'shell.cwd': input.cwd ?? '',
        },
        function: 'ShellExecution',
        module: host,
        args: input,
        result: null,
      };
    case 'mcp':
      // MCP tool calls classify as `llm_tool_call`. The classifier
      // requires `gen_ai.system` plus `http.method` and `http.url`
      // to take this branch (see the "LLM detection caveat" section
      // of `span-reference.md`).
      return {
        ...b,
        name: `tool.${input.tool_name ?? 'call'}`,
        hook_type: 'function_call',
        semantic_type: 'llm_tool_call',
        attributes: {
          'gen_ai.system': 'mcp',
          'http.method': 'POST',
          'http.url': 'https://api.openai.com/v1/chat/completions',
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
      return {
        ...b,
        name: 'http.request',
        hook_type: 'function_call',
        semantic_type: `http_${(input.method ?? 'get').toLowerCase()}`,
        attributes: {
          'http.method': input.method ?? 'GET',
          'http.url': input.url ?? '',
        },
        function: 'HTTPCall',
        module: host,
        args: input,
        result: null,
      };
  }
}
