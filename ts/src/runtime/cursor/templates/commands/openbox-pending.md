---
name: openbox-pending
description: List pending HITL approvals through the OpenBox MCP tool.
---

# Pending Approvals

Default behavior is organization-wide: show all pending approvals the
current user can read.

Use the OpenBox MCP tool first:

```text
list_pending_approvals
```

Print rows in a compact table: event id, action summary, agent, age.
If there are no rows, say exactly: `No pending approvals.`

Do not use shell commands for this workflow unless the user explicitly asks
for a separate CLI/API command.
