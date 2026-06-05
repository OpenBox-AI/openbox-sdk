---
name: openbox-status
description: Live ping against the OpenBox backend through the OpenBox MCP server.
---

# OpenBox status

Use the OpenBox MCP tool first:

```
openbox_status
```

This is a live backend ping through the installed OpenBox MCP server,
so it works even when shell execution is governed or blocked.

## Output

- On success: `OpenBox: connected` (one line, nothing else).
- On error: `OpenBox: not reachable - <error>` (one line, surface
  the message verbatim). Then suggest `/openbox-doctor` if the user
  wants the full install diagnostic.
- If the OpenBox MCP server is unavailable, say `OpenBox: MCP unavailable`
  and suggest `/openbox-doctor`. Do not fall back to shell unless the
  user explicitly asks you to.

Do not mention environment names in your output.
