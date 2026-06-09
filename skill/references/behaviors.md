# Behavior Rules

Behavior rules are OpenBox backend policy objects. Runtime code should
not duplicate their decisions. It should send complete Core events and
enforce the verdict returned by Core.

Typical outcomes:

- `allow`: continue unchanged.
- `constrain`: continue only with transformed/redacted payload.
- `require_approval`: pause and surface HITL approval.
- `block`: do not execute/release.
- `halt`: stop the session and block later governed gates.

## Managing Rules

Use the backend API surface or dashboard. From the CLI, call generated
operation IDs:

```sh
openbox api backend AgentController_getBehaviorRuleList --params '{"agentId":"..."}'
openbox api backend AgentController_createBehaviorRule --params '{"agentId":"..."}' --body @rule.json
openbox api backend AgentController_updateBehaviorRule --params '{"agentId":"...","ruleId":"..."}' --body @rule.json
openbox api backend AgentController_deleteBehaviorRule --params '{"agentId":"...","ruleId":"..."}'
```

## SDK Integration Rule

Do not hard-code behavior-rule checks in an adapter. The adapter sends
events to Core and enforces Core's verdict.
