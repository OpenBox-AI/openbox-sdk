---
name: openbox-status
description: Summarize current OpenBox install — active env, auth state, and pending approvals.
---

# OpenBox status

Pull a quick health snapshot:

1. `openbox config list` — current env + saved settings
2. `openbox auth status` — whether an X-API-Key is loaded for the
   active env
3. `openbox approval pending` — count of pending HITL items

Summarize the three answers in three short lines for the user. If
any of the calls error, surface the message verbatim and suggest
running `/openbox-doctor`.
