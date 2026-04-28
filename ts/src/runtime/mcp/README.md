# `runtime/mcp/` - OpenBox SDK ↔ MCP

Model Context Protocol server runtime - exposes OpenBox tools and
resources over stdio JSON-RPC to any MCP-compatible LLM tool (Claude
Desktop, Cursor, Claude Code, etc.).

## Public surface

```ts
import { runMcpServer } from 'openbox-sdk/runtime/mcp';
await runMcpServer();
```

Wired to the CLI as:

```bash
openbox mcp serve   # starts the stdio MCP server
```

`openbox mcp serve` is what the LLM tool's `mcpServers` config block
points its `command` at. The server runs for the lifetime of the
LLM session (long-lived, not per-event), then exits when stdin closes.

## Files

| File | Role |
|---|---|
| `index.ts` | `runMcpServer()` - starts the StdioServerTransport, registers tools + resources, blocks on connection. |
| `config.ts` | Env / token / API factory. Uses `openbox-sdk/env` for environments + token store. |

## Tools exposed

(See `index.ts` for the source of truth.)

- `get_profile` - current user + permissions
- `list_agents`, `get_agent`
- `list_pending_approvals`
- `decide_approval`
- `check_governance` - evaluate a span via the core client
- … plus skill resources (`openbox://skill/<ref>`) for the SKILL.md
  references when a skill copy is installed in `~/.claude/skills/openbox/`

## Differences from the hook-protocol adapters

`runtime/claude-code/` and `runtime/cursor/` are spec-emitted hook
adapters - fresh-process-per-event, stdin/stdout JSON, dispatched by
event-name. `runtime/mcp/` is NOT spec-emitted: MCP's protocol is
JSON-RPC with request-response correlation, not a per-event
discriminator. Tools and resources are hand-registered in `index.ts`.

If/when you want spec-driven MCP tool registration, the right move
is a new TypeSpec decorator family (`@mcpTool`) - same idea as
`@adapter`, different transport.
