// Pull a single-string summary out of an approval's `input` payload.
// Mirrors the activity-type mapping used everywhere else in the SDK;
// keep both branches identical or two consumers will diverge for the
// same approval.

/**
 * Pull the most informative single-string summary from `approval.input`
 * for the given activity_type. The approval sheet shows this as the
 * "Action" row; it's what the agent is asking permission to do.
 *
 * Returns null when there's nothing to render (no input, unknown type
 * with non-stringifiable payload). Caller hides the row in that case.
 *
 * Design: the wire shape (`input`) is `unknown[]` per the govern
 * protocol; singletons are always wrapped in a one-element array.
 * We read input[0] as the relevant payload object and pull the field
 * that matters for that activity type.
 */
export function summarizeInput(
  activityType: string | null | undefined,
  input: unknown,
): string | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const first = input[0];
  if (first == null) return null;

  // Primitive payload; render as-is.
  if (typeof first !== 'object') return String(first);
  const obj = first as Record<string, unknown>;

  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === 'string' && v.length > 0) return v;
    }
    return null;
  };

  switch (activityType) {
    // Coding-agent canonical activity types
    case 'ShellExecution':
    case 'ShellOutput':
      return pick('command');
    case 'PromptSubmission':
    case 'UserPromptSubmit':
    case 'beforeSubmitPrompt':
    case 'LLMCompleted':
    case 'AgentResponse':
    case 'AgentThinking':
    case 'on_llm_start':
    case 'on_llm_end':
    case 'on_chat_model_start':
      return pick('prompt', 'message', 'text', 'content');
    case 'FileRead':
    case 'FileEdit':
    case 'FileDelete':
    case 'beforeReadFile':
    case 'afterFileEdit':
      return pick('file_path', 'path');
    case 'HTTPRequest': {
      const method = pick('method', 'http_method');
      const url = pick('url', 'http_url');
      if (method && url) return `${method} ${url}`;
      return url ?? method;
    }
    case 'MCPToolCall':
    case 'MCPToolResponse':
    case 'beforeMCPExecution':
    case 'afterMCPExecution': {
      const server = pick('server', 'mcp_server');
      const tool = pick('tool_name', 'tool', 'name');
      if (server && tool) return `${server}.${tool}`;
      return tool ?? server;
    }
    case 'PreToolUse':
    case 'PostToolUse':
    case 'preToolUse':
    case 'postToolUse':
    case 'ToolStarted':
    case 'ToolCompleted':
    case 'on_tool_start':
    case 'on_tool_end':
      return pick('tool_name', 'tool', 'name', 'command', 'description');
    case 'AgentSpawn':
    case 'subagentStop':
    case 'SubagentStop':
      return pick('agent_type', 'task', 'description');
    default:
      // Unknown activity type; try common single-string fields first,
      // then fall through to a JSON snippet.
      return (
        pick('description', 'name', 'title', 'summary', 'command', 'message') ??
        truncate(JSON.stringify(obj), 200)
      );
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
