---
name: openbox-list-agents
description: List agents in the active workspace with their current trust score. (uses experimental commands)
---

# List agents

Use the OpenBox MCP tool first:

```
list_agents
```

Render the result as a short table: id (truncated to 8), name,
status, trust score.

If the user follows up with an id, use:

```
get_agent
```

Do not fall back to shell unless the user explicitly asks you to. If
MCP is unavailable and the user asks for shell fallback, `agent`
subcommands are gated behind `--experimental`, so include the flag.
Don't mention environment names in your output.
