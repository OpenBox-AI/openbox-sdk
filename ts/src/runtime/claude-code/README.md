# `runtime/claude-code/` - OpenBox SDK ↔ Claude Code

This folder is the OpenBox integration with [Claude Code](https://claude.com/claude-code).

It contains TWO surfaces, both reachable via `import ... from 'openbox-sdk/runtime/claude-code'`:

## 1. Adapter primitive (spec-emitted)

Re-exported from the auto-generated module
`ts/src/core-client/generated/runtime/claude-hooks.ts` (driven by
`@adapter("claude-hooks", "claude-code", "hook_event_name")` in
`specs/typespec/govern/adapters.tsp`).

```ts
import { createClaudeHooksAdapter } from 'openbox-sdk/runtime/claude-code';
```

Use this if you're building a custom Claude Code integration on top of
the OpenBox SDK. The adapter handles transport (stdin JSON →
event-name dispatch → verdict-mapped stdout) generically; you supply
per-event handlers.

## 2. Platform integration

Hand-written modules in this folder make up OpenBox's pre-built Claude
Code integration - what `openbox claude-code install` writes into
`~/.claude/settings.json` and what runs when Claude Code invokes
`openbox claude-code hook` per hook event.

| File | Role |
|---|---|
| `index.ts` | Public sub-path entry - re-exports the adapter primitive + integration entry points. |
| `hook-handler.ts` | `runClaudeHook()` - wires `createClaudeHooksAdapter` to per-tool mappers. |
| `install.ts` | `installClaudeHooks()` / `uninstallClaudeHooks()` - settings.json writers. |
| `mappers/*.ts` | One per hook event (PreToolUse, PostToolUse, UserPromptSubmit, …). Tool-name → activity-type routing lives here. |
| `config.ts` | Reads `~/.claude-hooks/config.json` + env vars. |
| `session-resolver.ts` | Maps Claude's `session_id` → OpenBox `workflowId`/`runId`. |
| `session-store.ts` | Persists the resolution at `~/.claude-hooks/sessions/`. |
| `activity-types.ts` | The per-tool activity_type vocabulary the mappers fire (FileRead, ShellExecution, …). |
| `logger.ts` | Logs hook input/output to `~/.claude-hooks/hook.log`. |

## Lifecycle

Claude Code spawns a fresh process per hook event. Each process:
1. `openbox claude-code hook` is invoked from `hooks.json`.
2. Reads stdin (the hook event JSON).
3. The adapter primitive parses + dispatches by `hook_event_name`.
4. The matching `mappers/<event>.ts` translates Claude's input into a
   GovernedPayload + calls `session.activity('ActivityStarted',
   '<ActivityType>', payload)` on the SDK session attached to the
   resolved workflow.
5. The verdict comes back. The adapter writes the verdict-mapped stdout
   per the operation's `@verdictShape` (permission-decision /
   decision-block / permission-request / none).
6. Process exits 0 (fail-open).
