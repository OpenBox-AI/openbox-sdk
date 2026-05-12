# `runtime/claude-code/`: OpenBox SDK ↔ Claude Code

OpenBox integration with [Claude Code](https://claude.com/claude-code).
Two surfaces via `import ... from 'openbox-sdk/runtime/claude-code'`:

1. **Adapter primitive**; `createClaudeCodeAdapter`, re-exported from
   the spec-emitted `core-client/generated/runtime/claude-code.ts`.
   Driven by `@adapter("claude-code", ...)` in
   `specs/typespec/govern/adapters.tsp`. Use this when building a
   custom integration on top of OpenBox.

2. **Platform integration**; `openbox claude-code {install,hook}`.
   `install.ts` writes `~/.claude/settings.json`; `hook-handler.ts`
   wires the spec-emitted adapter to per-event mappers in `mappers/`.

## Shared with cursor

Everything cross-cutting lives at the SDK top level; `openbox-sdk/logging`,
`/session`, `/install`, `/governance` (span builder + skip patterns +
events + rules projection + hook-event labels), `/approvals`
(socket client + server + resolve helper + source attribution),
`/config`, `/file-tokens` (agent-keys cache). The per-host code here is
only the parts that differ: envelope field binding, hook-event names,
and tool → activity-type / span-type maps.

## Lifecycle

Claude Code spawns a fresh process per hook event. Each process reads
the event JSON from stdin, dispatches by `hook_event_name`, the mapper
builds a payload + span and calls `session.activity(...)` on the
attached SDK session, the verdict comes back and the adapter writes
the verdict shape per `@verdictShape` (`permission-decision`,
`decision-block`, `permission-request`, or `none`), then exits 0
fail-open.
