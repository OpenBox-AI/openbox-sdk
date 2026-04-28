# OpenBox MCP

> Experimental, unofficial

MCP server that exposes OpenBox governance tools to AI agents in Cursor/Claude.

## Setup

```bash
npm install && npm run build
```

`npm install` pulls `openbox-sdk` from `github:OpenBox-AI/openbox-sdk`
(npm clones, runs the SDK's `prepare` hook, drops `dist/` into
`node_modules`). The MCP server uses the SDK's env registry, token
codec, and `X-Openbox-Client` variant resolver under the hood - same
sources of truth as the rest of the openbox ecosystem.

## Environment

```bash
# Defaults to production. Override per launch:
OPENBOX_ENV=staging  npm start
OPENBOX_ENV=local    npm start
```

`OPENBOX_API_URL` / `OPENBOX_CORE_URL` still override individual URLs
on top of the selected env. Tokens are read from
`~/.openbox/tokens` env-namespaced (e.g. `staging.ACCESS_TOKEN`); legacy
unprefixed entries are treated as production. Unknown env names hard-
fail rather than silently routing to production.

## Telemetry

Each backend request sends `X-Openbox-Client: runtime/mcp/<caller>` where
`<caller>` is the calling LLM tool's name from the MCP `initialize`
handshake (`claude-code`, `cursor`, `claude-desktop`, etc.). If the client
doesn't identify itself, the header is just `runtime/mcp`. Setting
`OPENBOX_CLIENT_VARIANT` in the operator's env appends an extra suffix.

## Auth

Requires `openbox` CLI for authentication:

```bash
# Install CLI
git clone https://github.com/OpenBox-AI/openbox-sdk.git
cd openbox-sdk && npm install && npm run build && npm link -w packages/cli

# Login (opens browser)
openbox auth login

# Verify
openbox auth profile
```

This saves your JWT to `~/.openbox/tokens` which the MCP server reads automatically.

## Register in Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "openbox": {
      "command": "node",
      "args": ["/path/to/runtime/mcp/dist/index.js"]
    }
  }
}
```

For `check_governance`, pass the agent API key:

```json
{
  "mcpServers": {
    "openbox": {
      "command": "node",
      "args": ["/path/to/runtime/mcp/dist/index.js"],
      "env": {
        "OPENBOX_API_KEY": "obx_live_..."
      }
    }
  }
}
```

Get the API key with: `openbox agent get <agent-id>` → `.token` field.

## Tools

| Tool | Auth | Description |
|---|---|---|
| `get_profile` | JWT | Current user profile and permissions |
| `list_agents` | JWT | All agents in the org |
| `get_agent` | JWT | Agent details with trust score |
| `get_trust_score` | JWT | Agent trust score and tier |
| `list_pending_approvals` | JWT | Pending approval requests |
| `decide_approval` | JWT | Approve or reject |
| `list_guardrails` | JWT | Agent guardrails |
| `list_policies` | JWT | Agent policies |
| `check_governance` | API key | Evaluate an action against governance rules |
