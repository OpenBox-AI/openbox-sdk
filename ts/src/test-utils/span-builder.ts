/**
 * Builds governance payloads with properly constructed spans for testing.
 * Handles all gate attributes, semantic type detection workarounds, and
 * payload structure so callers don't need to know the internals.
 */

function hex(len: number): string {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

/** Single source of truth for governance smoke-test span vocabulary.
 *  Adding a new shorthand is one entry here + one branch in `buildSpan`
 *  below. */
export const SPAN_TYPES = [
  'llm',
  'file_read',
  'file_write',
  'shell',
  'http',
  'db',
  'mcp',
] as const;

export type SpanType = (typeof SPAN_TYPES)[number];

export interface SpanOptions {
  type: SpanType;
  // Override the default activity_type, e.g. "PromptSubmission" or "FileRead".
  activityType?: string;
  /** Match the official temporal-sdk-python convention: hook-level
   *  events from `hook_governance.py` set `hook_trigger: true`;
   *  activity-level events from `activity_interceptor.py` do not. The
   *  hook path
   *  triggers `CheckApprovalCacheActivity` server-side which hits Redis.
   *  Default to false here so test payloads match the activity-level
   *  convention; flip to true when explicitly testing hook flows. */
  hookTrigger?: boolean;
  // LLM
  prompt?: string;
  model?: string;
  // File
  filePath?: string;
  content?: string;
  // Shell
  command?: string;
  cwd?: string;
  // HTTP
  method?: string;
  url?: string;
  // Database
  dbSystem?: string;
  dbOperation?: string;
  dbStatement?: string;
  // MCP
  toolName?: string;
  server?: string;
  toolInput?: string;
}

interface BuiltPayload {
  source: string;
  event_type: string;
  workflow_id: string;
  run_id: string;
  workflow_type: string;
  activity_id: string;
  activity_type: string;
  task_queue: string;
  attempt: number;
  timestamp: string;
  hook_trigger: boolean;
  activity_input: unknown[];
  spans: Record<string, unknown>[];
  span_count: number;
}

export function buildTestPayload(opts: SpanOptions): BuiltPayload {
  const workflowId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const activityId = crypto.randomUUID();
  const spanId = hex(16);
  const traceId = hex(32);
  const nowNs = Date.now() * 1_000_000;

  const { activityType: defaultActivityType, activityInput, span } = buildSpan(opts, spanId, traceId, nowNs);

  return {
    source: 'workflow-telemetry',
    event_type: 'ActivityStarted',
    workflow_id: workflowId,
    run_id: runId,
    workflow_type: 'TestWorkflow',
    activity_id: activityId,
    activity_type: opts.activityType || defaultActivityType,
    task_queue: 'cli-test',
    attempt: 1,
    timestamp: new Date().toISOString(),
    hook_trigger: opts.hookTrigger ?? false,
    activity_input: [activityInput],
    spans: [span],
    span_count: 1,
  };
}

function buildSpan(
  opts: SpanOptions,
  spanId: string,
  traceId: string,
  nowNs: number,
): { activityType: string; activityInput: Record<string, unknown>; span: Record<string, unknown> } {
  const base = {
    span_id: spanId,
    trace_id: traceId,
    parent_span_id: null,
    kind: 'CLIENT',
    stage: 'started',
    start_time: nowNs,
    end_time: null,
    duration_ns: null,
    status: { code: 'OK', description: null },
    events: [],
    error: null,
  };

  switch (opts.type) {
    case 'llm': {
      const input = { prompt: opts.prompt || 'test prompt' };
      return {
        activityType: 'PromptSubmission',
        activityInput: input,
        span: {
          ...base,
          name: 'llm.chat.completion',
          hook_type: 'function_call',
          semantic_type: 'llm_completion',
          attributes: {
            'gen_ai.system': 'openai',
            'gen_ai.model': opts.model || 'gpt-4',
            // Core currently classifies LLM spans from HTTP attributes.
            'http.method': 'POST',
            'http.url': 'https://api.openai.com/v1/chat/completions',
          },
          function: 'LLMCall',
          module: 'activity',
          args: input,
          result: null,
        },
      };
    }

    case 'file_read': {
      const filePath = opts.filePath || '/tmp/test.txt';
      const input = { file_path: filePath, content: opts.content || '' };
      return {
        activityType: 'FileRead',
        activityInput: input,
        span: {
          ...base,
          name: 'file.read',
          kind: 'INTERNAL',
          hook_type: 'file_operation',
          semantic_type: 'file_read',
          attributes: {
            'file.path': filePath,
            'file.operation': 'read',
          },
          file_path: filePath,
          file_mode: 'r',
          file_operation: 'read',
        },
      };
    }

    case 'file_write': {
      const filePath = opts.filePath || '/tmp/test.txt';
      const input = { file_path: filePath, content: opts.content || '' };
      return {
        activityType: 'FileEdit',
        activityInput: input,
        span: {
          ...base,
          name: 'file.write',
          kind: 'INTERNAL',
          hook_type: 'file_operation',
          semantic_type: 'file_write',
          attributes: {
            'file.path': filePath,
            'file.operation': 'write',
          },
          file_path: filePath,
          file_mode: 'w',
          file_operation: 'write',
        },
      };
    }

    case 'shell': {
      const command = opts.command || 'echo hello';
      const input = { command, cwd: opts.cwd || '/tmp' };
      return {
        activityType: 'ShellExecution',
        activityInput: input,
        span: {
          ...base,
          name: 'ShellExecution',
          kind: 'INTERNAL',
          hook_type: 'function_call',
          semantic_type: 'internal',
          attributes: {
            'shell.command': command,
            'shell.cwd': opts.cwd || '/tmp',
          },
          function: 'ShellExecution',
          module: 'activity',
          args: input,
          result: null,
        },
      };
    }

    case 'http': {
      const method = (opts.method || 'POST').toUpperCase();
      const url = opts.url || 'https://api.example.com/action';
      const input = { http_method: method, http_url: url };
      return {
        activityType: 'HTTPRequest',
        activityInput: input,
        span: {
          ...base,
          name: `${method} ${url}`,
          hook_type: 'http_request',
          semantic_type: `http_${method.toLowerCase()}`,
          attributes: {
            'http.method': method,
            'http.url': url,
          },
          http_method: method,
          http_url: url,
          request_body: null,
          response_body: null,
          request_headers: null,
          response_headers: null,
          http_status_code: null,
        },
      };
    }

    case 'db': {
      const system = opts.dbSystem || 'postgresql';
      const operation = (opts.dbOperation || 'SELECT').toUpperCase();
      const statement = opts.dbStatement || 'SELECT * FROM users';
      const input = { db_system: system, db_operation: operation, db_statement: statement };
      return {
        activityType: 'DatabaseQuery',
        activityInput: input,
        span: {
          ...base,
          name: `${operation} ${statement.split(' ').slice(0, 3).join(' ')}`,
          hook_type: 'db_query',
          semantic_type: `database_${operation.toLowerCase()}`,
          attributes: {
            'db.system': system,
            'db.operation': operation,
            'db.statement': statement,
          },
          db_system: system,
          db_name: null,
          db_operation: operation,
          db_statement: statement,
          server_address: null,
          server_port: null,
          rowcount: null,
        },
      };
    }

    case 'mcp': {
      const toolName = opts.toolName || 'search';
      const serverName = opts.server || 'mcp-server';
      const input = { server: serverName, tool_name: toolName, tool_input: opts.toolInput || '' };
      return {
        activityType: 'MCPToolCall',
        activityInput: input,
        span: {
          ...base,
          name: `MCP callTool ${toolName}`,
          hook_type: 'function_call',
          semantic_type: 'mcp_tool_call',
          attributes: {
            'mcp.method': 'callTool',
            'mcp.operation': toolName,
            'mcp.server_id': serverName,
            'mcp.input': input.tool_input,
            'openbox.semantic_type': 'mcp_tool_call',
            'openbox.span_type': 'mcp_tool_call',
          },
          function: `mcp.${toolName}`,
          module: 'activity',
          args: input,
          result: null,
        },
      };
    }
  }
}
