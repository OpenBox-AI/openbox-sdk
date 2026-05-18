---
name: openbox-status
description: Live ping against the OpenBox backend. Different from `/openbox-doctor` (which inspects local install state).
---

# OpenBox status

Use the OpenBox MCP tool first:

```
cursor_status
```

This is a live backend ping through the installed OpenBox MCP server,
so it works even when shell execution is governed or blocked.

## Output

- On success: `OpenBox: connected` (one line, nothing else).
- On error: `OpenBox: not reachable - <error>` (one line, surface
  the message verbatim). Then suggest `/openbox-doctor` if the
  user wants the full install diagnostic.
- If the OpenBox MCP server is unavailable, say `OpenBox: MCP unavailable`
  and suggest `/openbox-doctor`. Do not fall back to shell unless the
  user explicitly asks you to.

## How this differs from /openbox-doctor

`/openbox-doctor` reads local config (token file, configured URLs,
key format, etc.) and probes a few endpoints. It tells you whether
your install is *set up* correctly.

`/openbox-status` only does the one network ping. It tells you
whether the backend is *responding right now*. Use it as a quick
"am I online" check; use `/openbox-doctor` when status says
something's wrong and you want to know what.

Don't mention environment names in your output.
