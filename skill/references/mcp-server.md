<!-- TODO: post-monorepo-consolidation rewrite. References below describe the standalone repos; the consolidated openbox-sdk has the same surface under openbox-sdk/runtime/<x> sub-paths and openbox-sdk CLI subcommands. -->
# OpenBox MCP Server Reference

The OpenBox MCP server exposes governance tools directly to any MCP-compatible AI agent (Cursor, Claude Code, Windsurf, etc.).

- Repo: `github.com/OpenBox-AI/openbox-sdk`
- Runtime: Node.js (stdio transport)

## Tools

| Tool | Description | Key params |
|------|-------------|------------|
| `check_governance` | Evaluate an action against governance rules with proper span construction | `agent_id?`, `span_type`, `activity_input` |
| `get_profile` | Get current user profile and permissions | - |
| `get_agent` | Get agent details | `agent_id` |
| `list_agents` | List all agents | - |
| `get_trust_score` | Get agent trust score and tier | `agent_id` |
| `list_pending_approvals` | List pending HITL approvals | `agent_id` |
| `decide_approval` | Approve or reject a pending approval | `agent_id`, `approval_id`, `action` |
| `list_guardrails` | List configured guardrails | `agent_id` |
| `list_policies` | List configured OPA policies | `agent_id` |

### check_governance

The primary governance tool. Accepts `span_type` to build spans with correct gate attributes automatically:

| `span_type` | What it governs | Built span attributes |
|-------------|----------------|----------------------|
| `llm` | LLM completion calls | `gen_ai.system`, `http.method`, `http.url` |
| `file_read` | File read operations | `file.path`, `file.operation: "read"` |
| `file_write` | File write operations | `file.path`, `file.operation: "write"` |
| `shell` | Shell command execution | `shell.command`, `shell.cwd` |
| `http` | HTTP requests | `http.method`, `http.url` |
| `db` | Database queries | `db.system`, `db.operation` in `attributes`; `db_statement` as top-level span field (not inside `attributes`) |
| `mcp` | MCP tool calls | `gen_ai.system: "mcp"`, tool metadata |

API key resolution: uses `OPENBOX_API_KEY` env var, or fetches from agent record if `agent_id` is provided.

## Resources (Skill References)

The MCP server exposes skill reference files as readable resources:

| Resource | URI | Content |
|----------|-----|---------|
| `governance-flow` | `openbox://skill/governance-flow` | Event protocol, wire format, verdicts, approval polling, spec mismatches |
| `guardrails` | `openbox://skill/guardrails` | Guardrail configuration + debugging |
| `behaviors` | `openbox://skill/behaviors` | Behavior-rule triggers, states, enum quirks |
| `backend-api` | `openbox://skill/backend-api` | Backend response envelope, headers, auth |
| `rego-reference` | `openbox://skill/rego-reference` | Rego syntax, examples, policy lifecycle |
| `span-reference` | `openbox://skill/span-reference` | Span types, gate attributes, semantic type detection |
| `commands` | `openbox://skill/commands` | Full CLI command reference |
| `existing-sdks` | `openbox://skill/existing-sdks` | Available SDKs and installation |

Resources are read from `~/.claude/skills/openbox/references/` or `~/.cursor/skills/openbox/references/`.

## Installation

**Check if installed:** Look for `openbox` in `.cursor/mcp.json` or `~/.cursor/mcp.json`.

**Install:**
```bash
git clone https://github.com/OpenBox-AI/openbox-sdk.git ~/workspace/openbox-mcp
cd ~/workspace/openbox-mcp && npm install && npm run build
```

**Register in `.cursor/mcp.json`** (project-level) or `~/.cursor/mcp.json` (global):
```json
{
  "mcpServers": {
    "openbox": {
      "command": "node",
      "args": ["/path/to/openbox-mcp/dist/index.js"],
      "env": {
        "OPENBOX_API_KEY": "obx_live_..."
      }
    }
  }
}
```

Setting `OPENBOX_API_KEY` in `env` means `check_governance` works without passing `agent_id` each time. Without it, you must provide `agent_id` and the server resolves the key from the agent record (requires JWT auth via `~/.openbox/tokens`).

## Authentication

The MCP server uses two auth mechanisms:

- **Backend API** (`api.openbox.ai`): JWT from `~/.openbox/tokens` - used for management tools (get_agent, list_guardrails, etc.)
- **Core API** (`core.openbox.ai`): Agent API key (`obx_live_*`) - used for `check_governance` evaluations
