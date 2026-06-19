# Guardrails

Guardrails are backend-configured checks such as PII redaction,
toxicity filtering, prompt-injection detection, and other input/output
constraints.

Runtime integrations should:

- Send the actual prompt/tool/final-output payload to Core.
- Treat transformed payload from a constrained verdict as the only
  renderable source of truth.
- Never render raw payload after a constrained verdict.
- Fail closed if Core evaluation fails on a governed path.

## Managing Guardrails

Use the dashboard or generated backend operation IDs:

```sh
openbox api backend AgentController_getGuardrails --params '{"agentId":"..."}'
openbox api backend AgentController_createGuardrail --params '{"agentId":"..."}' --body @guardrail.json
openbox api backend AgentController_updateGuardrails --params '{"agentId":"...","guardrailId":"..."}' --body @guardrail.json
openbox api backend AgentController_deleteGuardrails --params '{"agentId":"...","guardrailId":"..."}'
```

Guardrails are evaluated by processing stage. Legacy
`settings.activities[].activity_type` and
`settings.activities[].fields_to_check` entries may still exist on old
records, but current backend/Core treats them as compatibility no-ops.
New guardrails should omit those fields.

## Runtime Proof

Use `openbox api core evaluateGovernance --body @event.json` for a CLI
smoke, or prefer `@openbox-ai/openbox-sdk/core-client` sessions in code.
