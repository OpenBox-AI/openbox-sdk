# Span Reference - Gate Attributes & Semantic Type Detection

## How Core Classifies Spans

Core runs classifiers in priority order on each span:
1. **LLM** - requires `http.method: "POST"` + `http.url` matching a known LLM domain → behavior triggers: `llm_completion`, `llm_embedding`, `llm_tool_call`
2. **HTTP** - requires `http.method` attribute → behavior triggers: `http_get`, `http_post`, `http_put`, `http_patch`, `http_delete`, `http`
3. **Database** - requires `db.system` attribute → behavior triggers: `database_select`, `database_insert`, `database_update`, `database_delete`, `database_query`
4. **File** - requires `file.path` attribute + span name matching `file.read`/`file.write`/`file.delete` → behavior triggers: `file_read`, `file_write`, `file_open`, `file_delete`
5. **Fallback** - everything else (including shell commands) becomes `internal` → behavior trigger: `internal`

Without the gate attribute, the span falls to `internal` and behavioral rules won't match.

**There is no `shell_execution` or `shell` behavior trigger.** Shell commands are classified as `internal`.

## LLM Detection Caveat

Core's `isLLMCall()` only recognizes HTTP POST to known domains:
`api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com`, `api.cohere.ai`, `api.mistral.ai`, `api.together.xyz`, `api.groq.com`, `api.perplexity.ai`, `api.fireworks.ai`, `api.deepseek.com`, `api.replicate.com`, `api-inference.huggingface.co`

Setting `gen_ai.system` alone is **not sufficient**. You must also include:
```json
"http.method": "POST",
"http.url": "https://api.openai.com/v1/chat/completions"
```

The `openbox-sdk` `gen_ai` span type and `runtime/cursor` inject these automatically. This is a workaround - remove when Core is updated to honor `gen_ai.system`.

## Span Type Quick Reference

### LLM (completion/tool_call/embedding)
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
Core detects subtype from span name: `COMPLETION` / `TOOL` / `EMBED` (case insensitive).

### File Read
```json
{
  "name": "file.read",
  "hook_type": "file_operation",
  "attributes": { "file.path": "/tmp/data.txt", "file.operation": "read" }
}
```

### File Write
```json
{
  "name": "file.write",
  "hook_type": "file_operation",
  "attributes": { "file.path": "/tmp/out.csv", "file.operation": "write" }
}
```

### Shell Command
```json
{
  "name": "ShellExecution",
  "hook_type": "function_call",
  "attributes": { "shell.command": "rm -rf /", "shell.cwd": "/tmp" }
}
```
Note: Core classifies shell spans as `internal` (no dedicated shell semantic type). Behavioral rules must target `internal` semantic type. The `shell.command` and `shell.cwd` attributes are available for OPA policies to inspect (e.g., `input.activity_input[0].command`).

### HTTP Request
```json
{
  "name": "POST https://api.example.com/refund",
  "hook_type": "http_request",
  "attributes": { "http.method": "POST", "http.url": "https://api.example.com/refund" }
}
```
Core detects subtype from span name: `GET`/`POST`/`PUT`/`PATCH`/`DELETE`.

### Database Query
```json
{
  "name": "SELECT users",
  "hook_type": "db_query",
  "attributes": { "db.system": "postgresql", "db.operation": "SELECT", "db.statement": "SELECT * FROM users" }
}
```
Core detects subtype from span name: `SELECT`/`INSERT`/`UPDATE`/`DELETE`.

### MCP Tool Call
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
The `http.method`/`http.url` attributes are intentional - core's `llm_tool_call` classifier only fires on `http.method=POST` spans whose `http.url` matches a known LLM domain. `gen_ai.system: "mcp"` distinguishes MCP tool calls from real LLM completions downstream. Both the `openbox` CLI (`--type mcp`) and the MCP server emit this exact shape.

## CLI Testing

```bash
openbox core evaluate --type llm --prompt "summarize this"
openbox core evaluate --type file_read --file-path /etc/passwd
openbox core evaluate --type file_write --file-path /tmp/out.csv
openbox core evaluate --type shell --command "rm -rf /"
openbox core evaluate --type http --method POST --url https://api.stripe.com/charges
openbox core evaluate --type db --db-system postgresql --db-statement "DROP TABLE users"
openbox core evaluate --type mcp --tool-name search --server github
openbox core evaluate --type llm --prompt "test" --show-payload  # inspect without sending
```

## MCP Testing

Use the `check_governance` tool with `span_type` parameter:
```
span_type: "llm", activity_input: {"prompt": "hello"}
span_type: "file_read", activity_input: {"file_path": "/tmp/secret.txt"}
span_type: "shell", activity_input: {"command": "rm -rf /"}
```
