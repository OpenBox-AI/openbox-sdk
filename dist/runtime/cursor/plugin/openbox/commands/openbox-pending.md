---
name: openbox-pending
description: List pending HITL approvals through MCP first, with API fallback only when explicitly requested.
---

# Pending Approvals

Default behavior is organization-wide: show all pending approvals the
current user can read.

## Preferred Path

Use the OpenBox MCP tool first:

```text
list_pending_approvals
```

Print rows in a compact table: event id, action summary, agent, age.
If there are no rows, say exactly: `No pending approvals.`

Do not fall back to shell unless the user explicitly asks you to.

## Shell Fallback

For one agent:

```sh
openbox api backend AgentController_getPendingApprovals \
  --params '{"agentId":"<agentId>"}'
```

To decide a row:

```sh
openbox api backend AgentController_decideApproval \
  --params '{"agentId":"<agentId>","eventId":"<eventId>"}' \
  --body '{"action":"approve"}'
```

Use `{"action":"reject"}` for rejection. Do not bulk-decide unless
the user explicitly asks.
