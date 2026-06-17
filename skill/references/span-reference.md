# Span Reference

OpenBox Core evaluates workflow/activity events and any spans attached
to them. Use spans to describe the risky surface precisely.

## Common Semantic Shapes

| Kind | Useful attributes |
|---|---|
| LLM prompt/completion | `gen_ai.system`, `gen_ai.request.model`, prompt/response fields |
| Shell | `process.command`, `shell.command` |
| File read/write | `file.path`, `file.operation` |
| HTTP | `http.method`, `http.url` |
| Database | `db.system`, `db.statement`, `db.operation` |
| MCP/tool call | `gen_ai.system=mcp`, tool/server names |

## Core API Smoke

Use the compact API caller for CLI smoke tests:

```sh
OPENBOX_API_KEY=$RUNTIME_KEY openbox api core evaluateGovernance \
  --body @event.json
```

For real integrations, prefer `@openbox-ai/openbox-sdk/core-client` sessions so
workflow IDs, run IDs, activity IDs, approval polling, redaction, and
final completion are handled consistently.

## MCP Runtime

The MCP runtime registers OpenBox tools and recipe tools directly.
Use `openbox mcp serve` as the host entrypoint; do not shell out to
removed CRUD command groups from MCP tools.
