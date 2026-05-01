# `runtime/claude-code/`: OpenBox SDK ↔ Claude Code

This folder is the OpenBox integration with
[Claude Code](https://claude.com/claude-code).

It contains two surfaces, both reachable via `import ... from
'openbox-sdk/runtime/claude-code'`.

## 1. Adapter primitive, spec-emitted

Re-exported from the auto-generated module at
`ts/src/core-client/generated/runtime/claude-code.ts`. The adapter is
driven by `@adapter("claude-code", "claude-code", "hook_event_name")`
in `specs/typespec/govern/adapters.tsp`.

```ts
import { createClaudeCodeAdapter } from 'openbox-sdk/runtime/claude-code';
```

Use this when building a custom Claude Code integration on top of the
OpenBox SDK. The adapter handles transport generically: stdin JSON in,
event-name dispatch, verdict-mapped stdout. You supply the per-event
handlers.

## 2. Platform integration

Hand-written modules in this folder make up OpenBox's pre-built Claude
Code integration. `openbox claude-code install` writes a hook block
into `~/.claude/settings.json`, and Claude Code invokes
`openbox claude-code hook` per hook event.

| File | Role |
|---|---|
| `index.ts` | Public sub-path entry. Re-exports the adapter primitive plus integration entry points |
| `hook-handler.ts` | `runClaudeHook()` wires `createClaudeCodeAdapter` to per-tool mappers |
| `install.ts` | `installClaudeCode()` and `uninstallClaudeCode()` write `settings.json` |
| `mappers/*.ts` | One per hook event: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, etc. Tool-name to activity-type routing lives here |
| `config.ts` | Reads `~/.claude-hooks/config.json` plus env vars |
| `session-resolver.ts` | Maps Claude's `session_id` to OpenBox `workflowId` and `runId` |
| `session-store.ts` | Persists the resolution at `~/.claude-hooks/sessions/` |
| `activity-types.ts` | Per-tool `activity_type` vocabulary the mappers fire: `FileRead`, `ShellExecution`, etc. |
| `logger.ts` | Logs hook input and output to `~/.claude-hooks/hook.log` |

## Lifecycle

Claude Code spawns a fresh process per hook event. Each process:

1. `openbox claude-code hook` is invoked from `hooks.json`.
2. Reads stdin: the hook event JSON.
3. The adapter primitive parses and dispatches by `hook_event_name`.
4. The matching `mappers/<event>.ts` translates Claude's input into a
   `GovernedPayload` and calls
   `session.activity('ActivityStarted', '<ActivityType>', payload)`
   on the SDK session attached to the resolved workflow.
5. The verdict comes back. The adapter writes verdict-mapped stdout
   per the operation's `@verdictShape`: `permission-decision`,
   `decision-block`, `permission-request`, or `none`.
6. Process exits 0, fail-open.
