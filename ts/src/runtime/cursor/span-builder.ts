// Span builder for governance evaluate payloads.
//
// Behavior rules match against spans by `semantic_type` + classifier
// gate attributes (`file.path`, `http.method`, `db.system`, `gen_ai.system`,
// `shell.command`); see `skill/references/span-reference.md`. Activity
// type alone does NOT trigger behavior rules — without a span carrying
// the right gate attributes, the request silently falls through to
// default-allow. Mirrors the shapes runtime/mcp/index.ts emits.

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

export type CursorSpanType =
  | 'llm'
  | 'file_read'
  | 'file_write'
  | 'file_delete'
  | 'shell'
  | 'mcp';

export interface CursorSpanInput {
  prompt?: string;
  response?: string;
  file_path?: string;
  command?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_output?: unknown;
}

/**
 * Build one span for the given cursor event. The semantic_type and gate
 * attributes are what core's classifier reads to decide which behavior
 * trigger fires (`file_read`, `internal`, `llm_completion`, ...). The
 * span is appended to the evaluate payload's `spans` array; without
 * it, behavior rules never match.
 */
export function buildCursorSpan(
  type: CursorSpanType,
  input: CursorSpanInput,
): Record<string, unknown> {
  const b = base();
  switch (type) {
    case 'llm':
      // LLM classifier requires http.method=POST + http.url matching a
      // known LLM domain; the cursor host abstracts the underlying model
      // call, so we tag a generic OpenAI-shaped url. See span-reference.md.
      return {
        ...b,
        name: 'llm.chat.completion',
        hook_type: 'function_call',
        semantic_type: 'llm_completion',
        attributes: {
          'gen_ai.system': 'cursor',
          'http.method': 'POST',
          'http.url': 'https://api.openai.com/v1/chat/completions',
        },
        function: 'LLMCall',
        module: 'cursor',
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
      // No `shell_execution` trigger exists — shell spans classify as
      // `internal` (per behaviors.md). To gate shells, create a
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
        module: 'cursor',
        args: input,
        result: null,
      };
    case 'mcp':
      // MCP tool calls classify as `llm_tool_call`. The classifier needs
      // a `gen_ai.system` + http.method/url to take this branch; see
      // span-reference.md "LLM detection caveat".
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
        module: 'cursor',
        args: input,
        result: input.tool_output ?? null,
      };
  }
}
