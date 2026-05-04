# openbox-cloud-bridge

Self-hosted webhook receiver that governs cloud-side agent runs the
local hook adapter can't see: Cursor background/cloud agents, bugbot
reviews, Slack/Linear-spawned runs, anything that emits a completion
webhook.

The local hook protocol gates actions in the editor; the cloud bridge
gates actions whose execution happens elsewhere. Same agent, same
guardrails, two surfaces.

## Status

Skeleton. The HTTP listener, signature verification, and payload
normalizer are real; the governance call is stubbed (returns `pass`)
until the SDK exposes a shared `check.ts` entrypoint that the bridge
and the MCP server's `check_governance` tool can both call.

Wiring the real governance call is a follow-up; see `src/handler.ts`.

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
| `OPENBOX_API_KEY`                | OpenBox key used for the eventual governance call                    |
| `OPENBOX_API_URL`                | Override the OpenBox API endpoint                                    |

If neither signing secret nor shared token is set, the bridge accepts
any request; fine for `127.0.0.1` dev, never for a public bind.

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
  "reason": "[stub] governed run run-42 for agent agt_abc123"
}
```

## Why a separate process

Local hooks fire inside the editor, blocked on the user's machine. A
cloud agent's run finishes wherever the cloud agent runs; the
provider's webhook needs a stable HTTPS endpoint that's nothing to do
with the user's laptop. Running this as a long-lived sidecar on
infrastructure the operator owns keeps the SDK side stateless.
