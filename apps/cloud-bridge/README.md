# openbox-cloud-bridge

Self-hosted webhook receiver that governs cloud-side agent runs the
local hook adapter can't see: Cursor background/cloud agents, bugbot
reviews, Slack/Linear-spawned runs, anything that emits a completion
webhook.

The local hook protocol gates actions in the editor; the cloud bridge
gates actions whose execution happens elsewhere. Same agent, same
guardrails, two surfaces.

## Status

The HTTP listener, signature verification, payload normalizer, and
governance call are implemented. When `OPENBOX_API_KEY` is a valid
agent runtime key (`obx_live_*` or `obx_test_*`), the bridge calls
`checkGovernance()` from `openbox-sdk/governance` and returns the
normalized verdict.

If no valid agent runtime key is configured, the bridge fails closed.
Pass-through behavior is available only for explicit unsafe local
development via `OPENBOX_BRIDGE_UNSAFE_LOCAL_DEV=1`.

## Run it

```bash
# from the monorepo root
bun install                       # picks up the workspace package
cd apps/cloud-bridge
bun run dev                       # http://127.0.0.1:8787
```

Environment:

| Variable                         | Purpose                                                              |
| -------------------------------- | -------------------------------------------------------------------- |
| `OPENBOX_BRIDGE_PORT`            | Default `8787`                                                       |
| `OPENBOX_BRIDGE_HOST`            | Default `127.0.0.1`. Bind `0.0.0.0` if exposing publicly.            |
| `OPENBOX_BRIDGE_SIGNING_SECRET`  | If set, requests must include `X-OpenBox-Signature: sha256=<hex>`    |
| `OPENBOX_BRIDGE_TOKEN`           | If set (and signing secret isn't), require `Authorization: Bearer …` |
| `OPENBOX_API_KEY`                | Agent runtime key (`obx_live_*` / `obx_test_*`) used for governance  |
| `OPENBOX_API_URL`                | Override the OpenBox API endpoint                                    |
| `OPENBOX_BRIDGE_UNSAFE_LOCAL_DEV`| Set to `1` only for unauthenticated local pass-through testing       |

If neither signing secret nor shared token is set, the bridge rejects
requests unless `OPENBOX_BRIDGE_UNSAFE_LOCAL_DEV=1` is set. Do not set
that variable on a public bind.

## Endpoints

- `GET /healthz` → `200 ok`
- `POST /webhook` → governance verdict

The webhook expects either:

- A JSON body with an `agent_id` field, or
- An `X-OpenBox-Agent` request header carrying the agent id.

```bash
curl -sS http://127.0.0.1:8787/webhook \
  -H 'content-type: application/json' \
  -H 'x-openbox-agent: agt_abc123' \
  -d '{"action":"cursor_cloud_agent_complete","artifact":{"diff":"…"},"source_run_id":"run-42"}'
```

Response:

```json
{
  "ok": true,
  "verdict": "pass",
  "reason": "governed run run-42 for agent agt_abc123"
}
```

## Why a separate process

Local hooks fire inside the editor, blocked on the user's machine. A
cloud agent's run finishes wherever the cloud agent runs; the
provider's webhook needs a stable HTTPS endpoint that's nothing to do
with the user's laptop. Running this as a long-lived sidecar on
infrastructure the operator owns keeps the SDK side stateless.
