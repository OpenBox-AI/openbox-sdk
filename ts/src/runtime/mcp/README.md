# `runtime/mcp/`: OpenBox SDK ↔ MCP

Model Context Protocol server runtime. Exposes OpenBox tools and
resources over stdio JSON-RPC to any MCP-compatible LLM tool, such as
Claude Desktop, Cursor, or Claude Code.

## Public surface

```ts
import { runMcpServer } from 'openbox-sdk/runtime/mcp';
await runMcpServer();
```

Wired to the CLI as:

```bash
openbox mcp serve   # starts the stdio MCP server
```

`openbox mcp serve` is the binary an LLM tool's `mcpServers` config
block points its `command` at. The server is long-lived: it runs for
the lifetime of the LLM session and exits when stdin closes.

## Files

| File | Role |
|---|---|
| `index.ts` | `runMcpServer()` starts the StdioServerTransport, registers tools and resources, then blocks on connection |
| `config.ts` | Env, token, and API factory. Uses `openbox-sdk/env` for environments and the token store |

## Tools exposed

`index.ts` is the source of truth for the registered tool set:

- `get_profile`: current user and permissions.
- `list_agents`, `get_agent`.
- `list_pending_approvals`.
- `decide_approval`.
- `check_governance`: evaluate a span via the core client.
- Skill resources at `openbox://skill/<ref>` surface the SKILL.md
  references when a project-local plugin is installed in either
  `<project>/.cursor/plugins/local/openbox/skills/openbox/` or
  `<project>/.claude/skills/openbox/skills/openbox/`.

## Differences from the hook-protocol adapters

`runtime/claude-code/` and `runtime/cursor/` are spec-emitted hook
adapters: fresh process per event, stdin and stdout JSON, dispatched
by event-name. `runtime/mcp/` is not spec-emitted. MCP's protocol is
JSON-RPC with request-response correlation, not a per-event
discriminator. Tools and resources are hand-registered in `index.ts`.

For future spec-driven MCP tool registration, the right move is a new
TypeSpec decorator family `@mcpTool`: same idea as `@adapter`,
different transport.
