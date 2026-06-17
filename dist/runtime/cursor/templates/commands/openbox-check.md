---
name: openbox-check
description: Evaluate a hypothetical agent action against OPA without executing it.
---

# Dry-run governance check

Ask the user (one sentence) which action they want to evaluate -
a shell command, a file write, a network call - and which agent
to evaluate it against (they can copy an id from the OpenBox
sidebar or run `/openbox-list-agents`).

Then use the OpenBox MCP tool:

```
check_governance
```

Map user intent into these MCP arguments:

- `agent_id`: the selected agent id.
- `span_type`: one of `shell`, `file_write`, `file_read`, `http`,
  `db`, `mcp`, `llm`.
- `activity_input`: the action payload.

Payload examples:

- `shell`: `{ "command": "pwd", "cwd": "/tmp" }`
- `file_write`: `{ "file_path": "/tmp/x", "content": "text" }`
- `file_read`: `{ "file_path": "/etc/hostname" }`
- `http`: `{ "method": "POST", "url": "https://example.com" }`
- `db`: `{ "system": "postgresql", "operation": "SELECT", "statement": "select 1" }`
- `mcp`: `{ "tool_name": "list_agents", "server": "openbox" }`
- `llm`: `{ "prompt": "summarize this", "model": "cursor" }`

The MCP server resolves cached runtime keys internally. Never print a
runtime key, paste it into chat, or include it in the final response.
Do not fall back to shell unless the user explicitly asks you to.

Report the verdict (`allow` / `require_approval` / `deny` /
`block`) and the matched rule id. If `require_approval`, mention
they can decide via `/openbox-pending` once it surfaces.

Don't mention environment names in your output.
