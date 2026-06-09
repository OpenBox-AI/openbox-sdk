---
name: openbox-check
description: Evaluate a hypothetical agent action against OpenBox governance without executing it.
---

# Dry-run governance check

Ask the user in one sentence which action they want to evaluate and
which OpenBox agent to evaluate it against. They can copy an id from
OpenBox or run `/openbox-list-agents`.

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
- `llm`: `{ "prompt": "summarize this", "model": "claude-code" }`

The MCP server resolves cached runtime keys internally. Never print a
runtime key, paste it into chat, or include it in the final response.
Do not fall back to shell unless the user explicitly asks you to.

Report the verdict and the matched rule id when present. If the
verdict requires approval, mention `/openbox-pending`.
