# Validation Checklist

Use these checks when proving an OpenBox SDK or host integration.

## Service Reachability

```sh
openbox health
openbox doctor
OPENBOX_API_KEY=$RUNTIME_KEY openbox api core validateApiKey
```

## Backend State

Use generated backend operation IDs instead of removed CRUD command groups:

```sh
openbox api backend AuthController_getProfile
openbox api backend AgentController_getAgents
openbox api backend AgentController_getAgent --params '{"agentId":"..."}'
openbox api backend AgentController_getGuardrails --params '{"agentId":"..."}'
openbox api backend AgentController_getBehaviorRuleList --params '{"agentId":"..."}'
openbox api backend AgentController_getCurrentPolicy --params '{"agentId":"..."}'
```

## Core Lifecycle Smoke

```sh
OPENBOX_API_KEY=$RUNTIME_KEY openbox api core evaluateGovernance \
  --body '{"event_type":"WorkflowStarted","workflow_id":"verify-test","run_id":"verify-run"}'

OPENBOX_API_KEY=$RUNTIME_KEY openbox api core evaluateGovernance \
  --body '{"event_type":"ActivityStarted","workflow_id":"verify-test","run_id":"verify-run","activity_id":"act-1","activity_type":"ToolCall","activity_input":[{"test":"data"}]}'

OPENBOX_API_KEY=$RUNTIME_KEY openbox api core evaluateGovernance \
  --body '{"event_type":"WorkflowCompleted","workflow_id":"verify-test","run_id":"verify-run"}'
```

Prefer SDK sessions for application code:

```ts
import { govern, presets } from '@openbox-ai/openbox-sdk/core-client';

await govern({ core, preset: presets.custom }, async (session) => {
  await session.activity('ActivityStarted', 'ToolCall', { input: { test: 'data' } });
});
```

## What Must Be Proven

- Prompt, tool input, tool output, approval, halt, and final output gates fail closed.
- `constrain` returns only transformed/redacted payload to renderers.
- `require_approval` pauses and resumes exactly once after approval.
- `halt` blocks later governed gates in the same session.
- `WorkflowStarted`, activity events, and `WorkflowCompleted` are emitted for complete runs.
- Backend rules/policies/guardrails are read from OpenBox, not duplicated in the app.

## After The App Runs

```sh
openbox api backend AgentController_getSessions --params '{"agentId":"..."}'
openbox api backend AgentController_getAgentEvaluations --params '{"agentId":"..."}'
openbox api backend AgentController_getAgentTrustHistories --params '{"agentId":"..."}'
```
