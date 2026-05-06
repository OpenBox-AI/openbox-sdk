---
name: openbox-pending
description: List pending HITL approvals and offer to decide them inline.
---

# Pending approvals

Run `openbox approval pending --json` and print the rows in a
compact table: agent_id (truncated), event_id (truncated), action
summary, age.

If the user asks to decide a row, call:

```
openbox approval decide <agentId> <eventId> --action <allow|deny|require_approval>
```

with the verdict they named. Don't bulk-decide unless the user
explicitly asks.
