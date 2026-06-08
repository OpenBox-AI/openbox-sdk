# OPA/Rego Policies

OpenBox policies are backend-managed OPA/Rego policy objects. The SDK
does not evaluate Rego locally during runtime. It sends complete Core
events and enforces Core/backend verdicts.

## Managing Policies

Use the dashboard or generated backend operation IDs:

```sh
openbox api backend AgentController_getCurrentPolicy --params '{"agentId":"..."}'
openbox api backend AgentController_createPolicy --params '{"agentId":"..."}' --body @policy.json
openbox api backend AgentController_updatePolicy --params '{"agentId":"...","policyId":"..."}' --body @policy.json
openbox api backend PolicyController_evaluate --body @policy-eval.json
```

## Runtime Rule

Do not embed Rego decision logic in app or adapter code. Keep Rego in
OpenBox, send governed events to Core, and enforce the returned
verdict.
