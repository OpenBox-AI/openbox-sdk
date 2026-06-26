# `runtime/mcp/`: OpenBox SDK ↔ MCP

Model Context Protocol server runtime. Exposes OpenBox tools, prompts,
and resource templates over stdio JSON-RPC or optional Streamable HTTP
to any MCP-compatible LLM tool, such as Claude Desktop, Cursor, or
Claude Code.

## Public surface

```ts
import { runMcpServer } from '@openbox-ai/openbox-sdk/runtime/mcp';
await runMcpServer();
```

Wired to the CLI as:

```bash
openbox mcp serve
openbox mcp serve --transport http --port 3927
```

`openbox mcp serve` is the binary an LLM tool's `mcpServers` config
block points its `command` at for stdio. The stdio server is long-lived:
it runs for the lifetime of the LLM session and exits when stdin closes.
The HTTP transport is opt-in and operator-owned.

## Files

| File | Role |
|---|---|
| `index.ts` | `runMcpServer()` starts the selected transport, registers TypeSpec-cataloged tools, prompts, and resource templates, then blocks on connection |
| `config.ts` | Env, token, and API factory. Uses `@openbox-ai/openbox-sdk/env` for environments and the token store |

## Protocol surfaces

`specs/typespec/govern/capabilities.tsp` is the source of truth for
MCP tool annotations, prompts, and resource templates. The generated
`MCP_TOOL_SURFACES`, `MCP_PROMPT_SURFACES`, and
`MCP_RESOURCE_TEMPLATE_SURFACES` catalogs drive runtime registration and
unit drift tests.

Tools include:

- `get_profile`: current user and permissions.
- `cursor_status`, `openbox_status`: compact backend status for slash
  commands.
- `codex_doctor`, `cursor_doctor`, `claude_code_doctor`: project-local install and
  runtime readiness diagnostics.
- `list_agents`, `get_agent`.
- `list_pending_approvals`.
- `decide_approval`.
- `list_guardrails`, `list_policies`.
- `get_trust_score`.
- `check_governance`: evaluate a span via the core client.
- Skill resources at `openbox://skill/<ref>` surface the SKILL.md
  references when a project-local plugin is installed in either
  `<project>/.cursor/plugins/local/openbox/skills/openbox/` or
  `<project>/.claude/skills/openbox/skills/openbox/`.
- Prompts cover OpenBox status, pending approvals, policy review,
  governance checks, and guardrail review.
- Resource templates cover agents, guardrails, policies, behavior rules,
  approvals, and skill references.

## Differences from the hook-protocol adapters

`runtime/claude-code/` and `runtime/cursor/` are spec-emitted hook
adapters: fresh process per event, stdin and stdout JSON, dispatched
by event-name. `runtime/mcp/` is a long-lived protocol server: MCP's
protocol is JSON-RPC with request-response correlation, not a per-event
discriminator. Core/backend still owns guardrails, OPA/Rego, behavior
rules, approval state, usage/cost, and verdicts; MCP only projects
cataloged protocol surfaces and sends governance checks to Core.
