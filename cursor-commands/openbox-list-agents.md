---
name: openbox-list-agents
description: List agents in the active env, with their current trust score.
---

# List agents

Run `openbox agent list --json` and render the result as a short
table: id (truncated to 8), name, status, trust score. If the user
follows up with an id, run `openbox agent get <id>` and show the
full record. To narrow by team, pass `--team <teamId>`.
