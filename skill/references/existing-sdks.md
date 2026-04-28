# OpenBox integration surfaces

How to wire an LLM agent or developer tool into OpenBox governance. Pick the
shortest path that matches the user's stack - falling through to a custom
integration is rarely the right answer.

---

## Decision tree

> *"What's the user actually trying to do?"*

1. **They use Claude Code, Cursor, or any MCP-compatible host.**
   → Don't write an SDK. Run an `openbox-sdk` install subcommand.
   The SDK ships a CLI that wires governance into the host's hook /
   slash / MCP system.

2. **They use a known agent framework** (LangChain, LangGraph, CrewAI,
   Mastra, Cloudflare Agents, DeepAgents, Temporal).
   → Use the framework-specific SDK below. It already constructs the
   workflow envelope, fires the right activity types, polls approvals,
   and applies redaction.

3. **They use TypeScript / Node.js directly** (no recognised framework,
   custom server, custom agent loop).
   → `npm install openbox-sdk` and use the `govern()` helper or
   `govern.attach()` (cross-process). Spec-driven, typed presets, the
   reference implementation for every other SDK.

4. **They use Python / Go / Rust** without a framework SDK.
   → Use the per-language SDK (Python: `openbox-sdk` on PyPI, Rust:
   `openbox-sdk` on crates.io, Go: `openbox-sdk` module). Same brand,
   same protocol, generated from the same TypeSpec source of truth as
   the TypeScript SDK.

5. **None of the above.**
   → Drop to raw `POST /api/v1/governance/evaluate` calls. Read
   `governance-flow.md` first; fire the full `WorkflowStarted →
   ActivityStarted/Completed → WorkflowCompleted` envelope or the agent
   audit will flag dangling sessions forever.

---

## openbox-sdk (TypeScript) - primary reference

**Install** (until npm publish):
```bash
npm install openbox-sdk@github:OpenBox-AI/openbox-sdk
```
**Or** the CLI globally for hook/MCP install commands:
```bash
npm install -g openbox-sdk@github:OpenBox-AI/openbox-sdk
```

**Sub-paths** (tree-shakeable; bundlers pull only what you import):

| Sub-path | Use for |
|---|---|
| `openbox-sdk` | Everything - root re-exports of the most common surfaces |
| `openbox-sdk/client` | `OpenBoxClient` (backend API: agents, teams, guardrails, …) |
| `openbox-sdk/core-client` | `OpenBoxCoreClient` (core API: evaluate, approval polling) + `govern()` + `govern.attach()` + 22 typed preset Sessions + redaction helpers |
| `openbox-sdk/env` | `ENVIRONMENTS`, `parseTokenStore`, `resolveClientName`, `EnvName` |
| `openbox-sdk/os-paths` | Node-only path resolver (RN-safe - kept off `/env`) |
| `openbox-sdk/types` | Hand-curated DTOs + auto-generated `Backend` / `Core` namespaces |
| `openbox-sdk/runtime/claude-code` | Claude Code hook adapter primitive + platform integration |
| `openbox-sdk/runtime/cursor` | Cursor IDE hook adapter primitive + platform integration |
| `openbox-sdk/runtime/mcp` | MCP server runtime (`runMcpServer()`) |

**Two ways to drive a session:**

```typescript
// Single-process: govern() opens + closes the workflow envelope around your body.
import { govern, presets } from 'openbox-sdk/core-client';
await govern({ core, preset: presets.claudeCode }, async (session) => {
  await session.preToolUse({ input: [{ tool_name: 'Read', file_path: '/x' }] });
});
```

```typescript
// Cross-process (per-event hook binary): govern.attach() - workflow lifecycle
// owned by the harness across many short-lived processes.
const session = govern.attach({
  core, preset: presets.claudeCode, workflowId, runId,
});
const verdict = await session.preToolUse({ input: [...] });
// Caller decides when to fire workflowStarted / workflowCompleted.
```

**Cross-preset escape**: `session.activity('ActivityStarted', 'FileRead', { input: [...] })`
fires arbitrary activity_types beyond the bound preset's typed methods. Used
internally by the runtime adapters for per-tool routing.

---

## CLI subcommands for host integrations

The `openbox` binary exposes one-shot install commands for each supported
LLM host. The user runs `openbox <host> install` once; the SDK writes the
right config block into the host's settings file and points it at
`openbox <host> hook` (or `openbox mcp serve`) for runtime.

| Host | Install | Hook entry / runtime |
|---|---|---|
| Claude Code | `openbox claude-code install` | `openbox claude-code hook` (per-event invocation) |
| Cursor IDE | `openbox cursor install` | `openbox cursor hook` (per-event invocation) |
| MCP-compatible (Claude Desktop, etc.) | configure their `mcpServers` block | `openbox mcp serve` (long-running JSON-RPC) |
| Skills | `openbox skill install` (or `--cursor`) | n/a - copies SKILL.md + references into `~/.claude/skills/openbox/` |

All four are flagged `experimental` in the CLI by default (newly merged
into the SDK). Pass `--experimental` or `OPENBOX_EXPERIMENTAL_LEVEL=experimental`
to surface them in `openbox --help`.

---

## Framework SDKs

| SDK | Package | Language | Framework |
|---|---|---|---|
| TypeScript SDK | `openbox-sdk` (this repo) | TypeScript | Any Node.js agent |
| Temporal Python | `OpenBox-AI/openbox-temporal-sdk-python` | Python | Temporal workflows |
| LangGraph Python | `OpenBox-AI/openbox-langgraph-sdk-python` | Python | LangGraph |
| LangChain Python | `OpenBox-AI/openbox-langchain-sdk-python` | Python | LangChain |
| LangChain TS | `OpenBox-AI/openbox-langchain-sdk-ts` | TypeScript | LangChain |
| Mastra | `OpenBox-AI/openbox-mastra-sdk` | TypeScript | Mastra |
| DeepAgents | `OpenBox-AI/openbox-deepagents-sdk-python` | Python | DeepAgents |
| Cloudflare Agents | `OpenBox-AI/openbox-cloudflare-agents-sdk` | TypeScript | Cloudflare Workers |

All framework SDKs ride on top of `openbox-sdk` - they wrap the TypeScript
core (or its language-equivalent) with framework-native ergonomics
(callbacks, decorators, middleware) so users don't write event-construction
code by hand.

---

## What was archived (don't reference these)

The following standalone repos were merged into `openbox-sdk` and archived
on GitHub. Use `openbox-sdk` instead:

- `OpenBox-AI/openbox-typescript-sdk` → superseded by `openbox-sdk` root +
  sub-paths. Redaction helpers (`applyInputRedaction`, `applyOutputRedaction`,
  `deepUpdateObject`) ported to `openbox-sdk/core-client`.
- `OpenBox-AI/claude-hooks` → `openbox-sdk/runtime/claude-code` + `openbox claude-code` CLI.
- `OpenBox-AI/cursor-hooks` → `openbox-sdk/runtime/cursor` + `openbox cursor` CLI.
- `OpenBox-AI/openbox-mcp` → `openbox-sdk/runtime/mcp` + `openbox mcp serve` CLI.
- `OpenBox-AI/openbox-skill` → bundled into `openbox-sdk` + `openbox skill install` CLI.
- `OpenBox-AI/openbox-extension` → `openbox-sdk/apps/extension` (VS Code marketplace publish).
- `OpenBox-AI/openbox-api-client` → superseded by `openbox-sdk/client`.
