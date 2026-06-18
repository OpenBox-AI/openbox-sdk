# Governance Flow

Every governed run should emit a complete lifecycle:

1. `WorkflowStarted`
2. One or more activity events, usually `ActivityStarted` and
   `ActivityCompleted`
3. `WorkflowCompleted` or a terminal halted/blocked state

The same `workflow_id` and `run_id` must be reused for the run. Each
tool/action has its own `activity_id`.

## Verdict Handling

| Verdict | Runtime behavior |
|---|---|
| `allow` | Continue unchanged |
| `constrain` | Continue only with transformed data |
| `require_approval` | Pause, poll/surface approval, resume once |
| `block` | Stop the action/output |
| `halt` | Mark the session halted and block future gates |

## SDK First

Use `@openbox-ai/openbox-sdk/core-client` sessions for application code:

```ts
await govern({ core, preset: presets.custom }, async (session) => {
  await session.activity('ActivityStarted', 'PromptSubmission', { input });
  await session.activity('ActivityCompleted', 'LLMCompleted', { output });
});
```

Use the CLI only for smoke tests:

```sh
OPENBOX_API_KEY=$RUNTIME_KEY openbox api core evaluateGovernance --body @event.json
OPENBOX_API_KEY=$RUNTIME_KEY openbox api core pollApproval --body @approval-poll.json
```

Approval decisions are a backend/MCP action, not a Core operation:

```sh
OPENBOX_BACKEND_API_KEY=$BACKEND_KEY openbox api backend AgentController_decideApproval \
  --params '{"agentId":"...","eventId":"..."}' \
  --body '{"action":"approve"}'
```

Do not bypass Core by calling backend policy objects directly during
runtime enforcement.
