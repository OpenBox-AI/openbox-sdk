---
name: openbox-pending
description: List all pending HITL approvals by default, or one agent's pending approvals when an agent is specified. (uses experimental commands)
---

# Pending approvals

Default behavior is organization-wide: show all pending approvals the
current user can read. Only use the agent-specific command when the
user explicitly provides an agent id/name or asks for one agent.

## All pending approvals

Use the OpenBox MCP tool first:

```
list_pending_approvals
```

Print the rows in a compact table: event_id (truncated), action
summary, agent, age.

If there are no rows, say exactly: `No pending approvals.`

Do not fall back to shell unless the user explicitly asks you to.

## One agent

If the user supplied an agent id/name or explicitly asks for a
specific agent, the MCP tool still returns all pending rows. Filter
the result in chat by that agent. If MCP is unavailable and the user
explicitly asks for shell fallback, run:

```
openbox --experimental approval pending <agentId> --json
```

If the user asks to decide a row, call:

```
openbox --experimental approval decide <agentId> <eventId> <approve|reject>
```

Don't bulk-decide unless the user explicitly asks. Don't mention
environment names in your output.
