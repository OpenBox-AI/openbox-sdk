---
name: openbox-check
description: Evaluate a hypothetical agent action against OPA without executing it. (uses experimental commands)
---

# Dry-run governance check

`core` subcommands are gated behind `--experimental`. Always
include the flag in invocations.

Ask the user (one sentence) which action they want to evaluate -
a shell command, a file write, a network call - and which agent
to evaluate it against (they can copy an id from the OpenBox
sidebar or run `/openbox-list-agents`).

Then call:

```
OPENBOX_API_KEY=<runtime-key-for-that-agent> \
  openbox --experimental core evaluate \
    --type <shell|file_write|file_read|http|db|mcp|llm> \
    [type-specific flags]
```

Type-specific flags:

- `--type shell --command "<cmd>"`
- `--type file_write --file-path <path> --content "<text>"`
- `--type file_read --file-path <path>`
- `--type http --method <GET|POST|...> --url <url>`
- `--type db --db-system <pg|mysql|...> --db-statement "<sql>"`
- `--type mcp --tool-name <name> --server <name>`
- `--type llm --prompt "<text>" --model <name>`

The runtime key is in `~/.openbox/agent-keys/<agentId>` after
`openbox api-key rotate <agentId>` (rotate IS stable - no flag
needed). If the user hasn't rotated yet, point them at that
command first.

Report the verdict (`allow` / `require_approval` / `deny` /
`block`) and the matched rule id. If `require_approval`, mention
they can decide via `/openbox-pending` once it surfaces.

Don't mention environment names in your output.
