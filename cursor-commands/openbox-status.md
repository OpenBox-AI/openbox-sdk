---
name: openbox-status
description: Live ping against the OpenBox backend. Different from `/openbox-doctor` (which inspects local install state).
---

# OpenBox status

Run the shell command:

```
openbox health
```

This is a live HTTP ping against whichever OpenBox backend the
CLI is currently configured to talk to. It returns either
`"Success"` (the API is reachable) or an error message (network
down, wrong URL, auth rejected, etc.).

## Output

- On success: `OpenBox: connected` (one line, nothing else).
- On error: `OpenBox: not reachable - <error>` (one line, surface
  the message verbatim). Then suggest `/openbox-doctor` if the
  user wants the full install diagnostic.

## How this differs from /openbox-doctor

`/openbox-doctor` reads local config (token file, configured URLs,
key format, etc.) and probes a few endpoints. It tells you whether
your install is *set up* correctly.

`/openbox-status` only does the one network ping. It tells you
whether the backend is *responding right now*. Use it as a quick
"am I online" check; use `/openbox-doctor` when status says
something's wrong and you want to know what.

Don't mention environment names in your output.
