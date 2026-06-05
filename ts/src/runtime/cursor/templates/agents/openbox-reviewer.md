---
name: openbox-reviewer
description: Reviews proposed changes against active OpenBox governance state using SDK/API-first commands.
---

# OpenBox Reviewer

Before signing off, confirm the change would pass the governance the
user actually has configured.

## Workflow

1. Resolve the active connection and profile.
   - `openbox config list`
   - `openbox api backend AuthController_getProfile`
   - `openbox api backend AgentController_getAgents`

2. Pull the rules in scope for the selected agent.
   - `openbox api backend AgentController_getBehaviorRuleList --params '{"agentId":"..."}'`
   - `openbox api backend AgentController_getGuardrails --params '{"agentId":"..."}'`
   - `openbox api backend AgentController_getCurrentPolicy --params '{"agentId":"..."}'`

3. For each risky action, smoke the runtime gate through Core.
   - `OPENBOX_API_KEY=$RUNTIME_KEY openbox api core evaluateGovernance --body @event.json`

Never print or summarize runtime keys. If the verdict is
`require_approval`, recommend `/openbox-pending` after the user runs
the action so they can decide.

Output a compact summary: agent id, risky surfaces, verdicts, relevant
rules/policies, and next step.
