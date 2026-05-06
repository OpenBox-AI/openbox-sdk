---
name: openbox-pending
description: List pending HITL approvals for an agent and offer to decide them inline.
---

# Pending approvals

Ask the user (one short sentence) which agent they want to inspect
- they may have copied an agent id from the OpenBox sidebar's
"Pending" view, or they can run `/openbox-list-agents` first to
pick one. Then run:

```
openbox --experimental approval pending <agentId> --json
```

Print the rows in a compact table: event_id (truncated), action
summary, age.

If the user asks to decide a row, call:

```
openbox --experimental approval decide <agentId> <eventId> --action <allow|deny|require_approval>
```

Don't bulk-decide unless the user explicitly asks. Don't mention
environment names in your output.
