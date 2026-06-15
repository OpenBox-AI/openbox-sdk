// Span builder for MCP governance payloads with proper gate attributes.
function hex(len: number): string {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

export function buildMcpGovernanceSpan(
  spanType: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const base = {
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

  switch (spanType) {
    case 'llm':
      return {
        ...base,
        name: 'llm.chat.completion',
        hook_type: 'function_call',
        span_type: 'function',
        semantic_type: 'llm_completion',
        attributes: {
          'gen_ai.system': 'openai',
          'http.method': 'POST',
          'http.url': 'https://api.openai.com/v1/chat/completions',
          'openbox.semantic_type': 'llm_completion',
          'openbox.span_type': 'function',
        },
        function: 'LLMCall',
        module: 'activity',
        args: input,
        result: null,
      };
    case 'file_read':
      return {
        ...base,
        name: 'file.read',
        kind: 'INTERNAL',
        hook_type: 'file_operation',
        span_type: 'file_io',
        semantic_type: 'file_read',
        attributes: {
          'file.path': input.file_path || '',
          'file.operation': 'read',
          'openbox.semantic_type': 'file_read',
          'openbox.span_type': 'file_io',
        },
        file_path: input.file_path || '',
        file_mode: 'r',
        file_operation: 'read',
      };
    case 'file_write':
      return {
        ...base,
        name: 'file.write',
        kind: 'INTERNAL',
        hook_type: 'file_operation',
        span_type: 'file_io',
        semantic_type: 'file_write',
        attributes: {
          'file.path': input.file_path || '',
          'file.operation': 'write',
          'openbox.semantic_type': 'file_write',
          'openbox.span_type': 'file_io',
        },
        file_path: input.file_path || '',
        file_mode: 'w',
        file_operation: 'write',
      };
    case 'shell':
      return {
        ...base,
        name: 'ShellExecution',
        kind: 'INTERNAL',
        hook_type: 'function_call',
        span_type: 'function',
        semantic_type: 'internal',
        attributes: {
          'shell.command': input.command || '',
          'shell.cwd': input.cwd || '',
          'openbox.semantic_type': 'internal',
          'openbox.span_type': 'function',
        },
        function: 'ShellExecution',
        module: 'activity',
        args: input,
        result: null,
      };
    case 'http': {
      const method = ((input.method as string) || 'POST').toUpperCase();
      const url = (input.url as string) || 'https://api.example.com';
      return {
        ...base,
        name: `${method} ${url}`,
        hook_type: 'http_request',
        span_type: 'http',
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
      };
    }
    case 'db': {
      const dbOp = ((input.operation as string) || 'SELECT').toUpperCase();
      return {
        ...base,
        name: `${dbOp}`,
        hook_type: 'db_query',
        span_type: 'database',
        semantic_type: `database_${dbOp.toLowerCase()}`,
        attributes: {
          'db.system': input.system || 'postgresql',
          'db.operation': dbOp,
          'openbox.semantic_type': `database_${dbOp.toLowerCase()}`,
          'openbox.span_type': 'database',
        },
        db_system: input.system || 'postgresql',
        db_operation: dbOp,
        db_statement: input.statement || '',
      };
    }
    case 'mcp':
      return {
        ...base,
        name: `tool.${input.tool_name || 'call'}`,
        hook_type: 'function_call',
        span_type: 'mcp_tool_call',
        semantic_type: 'llm_tool_call',
        attributes: {
          'gen_ai.system': 'mcp',
          'http.method': 'POST',
          'http.url': 'https://api.openai.com/v1/chat/completions',
          'openbox.semantic_type': 'llm_tool_call',
          'openbox.span_type': 'mcp_tool_call',
          'openbox.tool.name': input.tool_name || 'call',
          'tool.name': input.tool_name || 'call',
          tool_name: input.tool_name || 'call',
        },
        function: `mcp.${input.tool_name || 'call'}`,
        module: 'activity',
        args: input,
        result: null,
      };
    default:
      return {
        ...base,
        name: 'unknown',
        kind: 'INTERNAL',
        hook_type: 'function_call',
        span_type: 'function',
        attributes: {},
        function: 'unknown',
        module: 'activity',
        args: input,
        result: null,
      };
  }
}

// Canonical activity_type values the skill emits. Must match what guardrail
// settings.activities[].activity_type specifies; no match, no fire.
export const MCP_ACTIVITY_TYPE_MAP: Record<string, string> = {
  llm: 'PromptSubmission',
  file_read: 'FileRead',
  file_write: 'FileEdit',
  shell: 'ShellExecution',
  http: 'HTTPRequest',
  db: 'DatabaseQuery',
  mcp: 'MCPToolCall',
};
