# `runtime/claude-code/`: OpenBox SDK ↔ Claude Code

OpenBox integration with [Claude Code](https://claude.com/claude-code).
Three surfaces are available via
`import ... from '@openbox-ai/openbox-sdk/runtime/claude-code'`:

1. **Adapter primitive**; `createClaudeCodeAdapter`, re-exported from
   the spec-emitted `core-client/generated/runtime/claude-code.ts`.
   Driven by `@adapter("claude-code", ...)` in
   `specs/typespec/govern/adapters.tsp`. Use this when building a
   custom integration on top of OpenBox.

2. **Hook runtime primitive**; `openbox claude-code hook`.
   Project plugins invoke it through `bin/openbox-cli.mjs`, which resolves
   an explicit `OPENBOX_CLI` or a project-local SDK install instead of a
   global binary. `hook-handler.ts` wires the spec-emitted adapter to per-event
   mappers in `mappers/`. `install.ts` is a compatibility alias for
   the plugin installer so SDK consumers do not write Claude settings
   directly.

3. **Claude Code plugin bundle**;
   `openbox install claude-code` or
   `openbox claude-code plugin {export,install,uninstall}`.
   `plugin.ts` packages the OpenBox skill, Claude slash commands,
   an OpenBox reviewer agent, `hooks/hooks.json`, `.mcp.json`, and
   `.claude-plugin/plugin.json` into a marketplace-ready plugin
   folder. Build asset sync emits the packaged plugin at
   `dist/runtime/claude-code/plugin/openbox`.

## Shared with cursor

Everything cross-cutting lives at the SDK top level; `@openbox-ai/openbox-sdk/logging`,
`/session`, `/install`, `/governance` (span builder + redaction patterns +
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
`decision-block`, `permission-request`, or `none`), then exits 0.
Decision-capable hook failures return the event-specific deny/block
shape; observe-only hooks pass through after best-effort telemetry.
