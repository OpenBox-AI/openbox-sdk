---
name: openbox-pending
description: List pending OpenBox HITL approvals through MCP.
---

# Pending approvals

Default behavior is organization-wide: show all pending approvals the
current user can read.

Use the OpenBox MCP tool first:

```
list_pending_approvals
```

Print the rows in a compact table: event_id (truncated), action
summary, agent, age.

If there are no rows, say exactly: `No pending approvals.`

If the user asks to decide a row, call:

```
decide_approval
```

Do not bulk-decide unless the user explicitly asks. Do not fall back
to shell unless the user explicitly asks you to.
