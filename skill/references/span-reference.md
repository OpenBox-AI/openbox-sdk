# Span reference: gate attributes and semantic-type detection

## How core classifies spans

Core runs classifiers in priority order on each span:

1. **LLM.** Requires `http.method: "POST"` and an `http.url` matching
   a known LLM domain. Behavior triggers: `llm_completion`,
   `llm_embedding`, `llm_tool_call`.
2. **HTTP.** Requires `http.method`. Behavior triggers: `http_get`,
   `http_post`, `http_put`, `http_patch`, `http_delete`, `http`.
3. **Database.** Requires `db.system`. Behavior triggers:
   `database_select`, `database_insert`, `database_update`,
   `database_delete`, `database_query`.
4. **File.** Requires `file.path` and a span name matching
   `file.read`, `file.write`, or `file.delete`. Behavior triggers:
   `file_read`, `file_write`, `file_open`, `file_delete`.
5. **Fallback.** Everything else, including shell commands, becomes
   `internal`. Behavior trigger: `internal`.

Without the gate attribute, the span falls to `internal` and behavior
rules will not match.

There is no `shell_execution` or `shell` behavior trigger. Shell
commands classify as `internal`.

## LLM detection caveat

Core's LLM classifier only recognizes HTTP POST to known domains:

```
api.openai.com, api.anthropic.com, generativelanguage.googleapis.com,
api.cohere.ai, api.mistral.ai, api.together.xyz, api.groq.com,
api.perplexity.ai, api.fireworks.ai, api.deepseek.com,
api.replicate.com, api-inference.huggingface.co
```

Setting `gen_ai.system` alone is not sufficient. You must also
include:

```json
"http.method": "POST",
"http.url": "https://api.openai.com/v1/chat/completions"
```

The `openbox-sdk` `gen_ai` span type and `runtime/cursor` inject
these automatically. This is a workaround. It can be removed once
core honors `gen_ai.system` directly.

## Span type quick reference

### LLM completion, tool call, or embedding

```json
{
  "name": "llm.chat.completion",
  "hook_type": "function_call",
  "semantic_type": "llm_completion",
  "attributes": {
    "gen_ai.system": "openai",
    "http.method": "POST",
    "http.url": "https://api.openai.com/v1/chat/completions"
  }
}
```

Core detects subtype from the span name. Match is case-insensitive
across `COMPLETION`, `TOOL`, and `EMBED`.

### File read

```json
{
  "name": "file.read",
  "hook_type": "file_operation",
  "attributes": { "file.path": "/tmp/data.txt", "file.operation": "read" }
}
```

### File write

```json
{
  "name": "file.write",
  "hook_type": "file_operation",
  "attributes": { "file.path": "/tmp/out.csv", "file.operation": "write" }
}
```

### Shell command

```json
{
  "name": "ShellExecution",
  "hook_type": "function_call",
  "attributes": { "shell.command": "rm -rf /", "shell.cwd": "/tmp" }
}
```

Core classifies shell spans as `internal`; there is no dedicated
shell semantic type. Behavior rules must target `internal`. The
`shell.command` and `shell.cwd` attributes are available for OPA
policies to inspect via `input.activity_input[0].command`.

### HTTP request

```json
{
  "name": "POST https://api.example.com/refund",
  "hook_type": "http_request",
  "attributes": { "http.method": "POST", "http.url": "https://api.example.com/refund" }
}
```

Core detects subtype from the span name across `GET`, `POST`, `PUT`,
`PATCH`, and `DELETE`.

### Database query

```json
{
  "name": "SELECT users",
  "hook_type": "db_query",
  "attributes": { "db.system": "postgresql", "db.operation": "SELECT", "db.statement": "SELECT * FROM users" }
}
```

Core detects subtype from the span name across `SELECT`, `INSERT`,
`UPDATE`, and `DELETE`.

### MCP tool call

```json
{
  "name": "tool.search",
  "hook_type": "function_call",
  "semantic_type": "llm_tool_call",
  "attributes": {
    "gen_ai.system": "mcp",
    "http.method": "POST",
    "http.url": "https://api.openai.com/v1/chat/completions"
  }
}
```

The `http.method` and `http.url` attributes are intentional. Core's
`llm_tool_call` classifier only fires on `http.method=POST` spans
whose `http.url` matches a known LLM domain. `gen_ai.system: "mcp"`
distinguishes MCP tool calls from real LLM completions downstream.
Both `openbox core evaluate --type mcp` and the MCP runtime emit this
exact shape.

## CLI testing

```bash
openbox core evaluate --type llm --prompt "summarize this"
openbox core evaluate --type file_read --file-path /etc/passwd
openbox core evaluate --type file_write --file-path /tmp/out.csv
openbox core evaluate --type shell --command "rm -rf /"
openbox core evaluate --type http --method POST --url https://api.stripe.com/charges
openbox core evaluate --type db --db-system postgresql --db-statement "DROP TABLE users"
openbox core evaluate --type mcp --tool-name search --server github
openbox core evaluate --type llm --prompt "test" --show-payload   # inspect the payload without sending
```

## MCP testing

Use the `check_governance` tool with the `span_type` parameter:

```
span_type: "llm",       activity_input: { "prompt": "hello" }
span_type: "file_read", activity_input: { "file_path": "/tmp/secret.txt" }
span_type: "shell",     activity_input: { "command": "rm -rf /" }
```
