# OpenBox integration surfaces

How to wire an LLM agent or developer tool into OpenBox governance.
Pick the shortest path that matches the user's stack. Falling through
to a custom integration is rarely the right answer.

## Decision tree

> *"What's the user actually trying to do?"*

1. **Claude Code, Cursor, or any MCP-compatible host.** Run
   `openbox <host> install`. The CLI writes the right config block
   into the host's settings file and wires governance through the
   host's hook, slash, or MCP system. No SDK code to write.

2. **Known agent framework** such as LangChain, LangGraph, CrewAI,
   Mastra, Cloudflare Agents, DeepAgents, or Temporal. If a
   framework-specific OpenBox SDK exists, use it. The framework SDK
   constructs the workflow envelope, fires the right activity types,
   polls approvals, and applies redaction. Ask the user which package
   they have access to; some live in a private registry.

3. **TypeScript or Node.js directly**, with no framework, a custom
   server, or a custom agent loop. `npm install openbox-sdk` and use
   `govern()` or `govern.attach()` from `openbox-sdk/core-client`.
   Spec-driven, typed presets, the reference implementation that
   other-language SDKs port from.

4. **Python, Go, or Rust** without a framework SDK. Use the
   per-language OpenBox SDK if one is published. Same brand, same
   protocol, generated from the same TypeSpec source of truth as the
   TypeScript SDK.

5. **None of the above.** Drop to raw
   `POST /api/v1/governance/evaluate` calls. Read `governance-flow.md`
   first. Fire the full envelope:
   `WorkflowStarted → ActivityStarted → ActivityCompleted →
   WorkflowCompleted`. Otherwise the agent audit lists the run as a
   dangling session.

## openbox-sdk on TypeScript

The reference implementation. Framework-specific SDKs lower from it.
Public sub-paths:

| Sub-path | Use for |
|---|---|
| `openbox-sdk` | Root re-exports of the most common surfaces |
| `openbox-sdk/client` | `OpenBoxClient`, the backend management API for agents, teams, guardrails, and the rest |
| `openbox-sdk/core-client` | `OpenBoxCoreClient` for the core API: evaluate, approval polling. Also `govern()`, `govern.attach()`, typed preset Sessions, redaction helpers |
| `openbox-sdk/env` | `ENVIRONMENTS`, `parseTokenStore`, `resolveClientName`, `EnvName` |
| `openbox-sdk/os-paths` | Node-only path resolver. Kept off `/env` for React Native |
| `openbox-sdk/types` | Hand-curated DTOs and the auto-generated `Backend` and `Core` namespaces |
| `openbox-sdk/runtime/claude-code` | Claude Code hook adapter |
| `openbox-sdk/runtime/cursor` | Cursor hook adapter |
| `openbox-sdk/runtime/mcp` | MCP server runtime, exposed as `runMcpServer()` |

Two ways to drive a session:

```typescript
// Single-process. govern() opens and closes the workflow envelope.
import { govern, presets } from 'openbox-sdk/core-client';
await govern({ core, preset: presets.claudeCode }, async (session) => {
  await session.preToolUse({ input: [{ tool_name: 'Read', file_path: '/x' }] });
});
```

```typescript
// Cross-process per-event hook binary. govern.attach(). The workflow
// lifecycle is owned by the harness across many short-lived processes.
const session = govern.attach({
  core, preset: presets.claudeCode, workflowId, runId,
});
const verdict = await session.preToolUse({ input: [...] });
// The caller decides when to fire workflowStarted and workflowCompleted.
```

**Cross-preset escape:**
`session.activity('ActivityStarted', 'FileRead', { input: [...] })`
fires arbitrary activity_types beyond the bound preset's typed
methods. Used by the runtime adapters for per-tool routing.

## CLI subcommands for host integrations

The `openbox` binary exposes one-shot install commands for each
supported LLM host. The user runs `openbox <host> install` once. The
SDK writes the right config block into the host's settings file and
points it at the matching hook entry or runtime.

| Host | Install | Hook entry or runtime |
|---|---|---|
| Claude Code | `openbox claude-code install` | `openbox claude-code hook`, per-event |
| Cursor IDE | `openbox cursor install` | `openbox cursor hook`, per-event |
| MCP-compatible host such as Claude Desktop | configure the host's `mcpServers` block | `openbox mcp serve`, long-running JSON-RPC |
| Skills | `openbox install skill` | n/a. Copies `SKILL.md` and references into `~/.claude/skills/openbox/` and `~/.cursor/skills/openbox/` |
