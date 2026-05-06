---
name: openbox-check
description: Evaluate a hypothetical agent action against OPA without executing it.
---

# Dry-run governance check

Ask the user (one sentence) which action they want to evaluate -
a shell command, a file write, a network call - and which agent
to evaluate it against (they can copy an id from the OpenBox
sidebar or run `/openbox-list-agents`).

Then call:

```
OPENBOX_API_KEY=<runtime-key-for-that-agent> \
  openbox --experimental core evaluate \
    --type <shell|file_write|file_read|http|db|mcp|llm> \
    --command "<the command>"   # for shell/file_write/etc; use the right --flag for the type
```

The runtime key is in `~/.openbox/agent-keys/<agentId>` after
`openbox --experimental api-key rotate <agentId>`. If the user
hasn't rotated yet, point them at that command first.

Report the verdict (`allow` / `require_approval` / `deny` /
`block`) and the matched rule id. If `require_approval`, mention
they can decide via `/openbox-pending` once it surfaces.

Don't mention environment names in your output.
