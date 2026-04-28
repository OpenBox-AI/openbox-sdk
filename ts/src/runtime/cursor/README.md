# `runtime/cursor/` - OpenBox SDK ↔ Cursor IDE

Mirror of `runtime/claude-code/` for [Cursor IDE](https://cursor.com).

Two surfaces, both via `import ... from 'openbox-sdk/runtime/cursor'`:

## 1. Adapter primitive (spec-emitted)

Re-exported from the auto-generated
`ts/src/core-client/generated/runtime/cursor.ts` (driven by
`@adapter("cursor", "cursor", "hook_event_name")` in
`specs/typespec/govern/adapters.tsp`).

```ts
import { createCursorAdapter } from 'openbox-sdk/runtime/cursor';
```

## 2. Platform integration

Used by `openbox cursor install` (writes `~/.cursor/hooks.json`) and
`openbox cursor hook` (the per-event handler).

Differences vs claude-code:
- Cursor's `before*` events are gating (`cursor-permission` verdict
  shape: `{ permission: 'allow' | 'deny', userMessage?, agentMessage? }`).
- Cursor's `after*` events are observe-only (`cursor-observe`: `{}`
  empty stdout).
- Session ID is `conversation_id` (not `session_id`).
- Cursor's `preToolUse` (Cursor 3.x) is THE primary tool-routing hook;
  `beforeShellExecution` / `beforeReadFile` only fire in cmd-k or have
  duplicate coverage. The integration treats `preToolUse` as
  authoritative and the others pass through.

Same module structure as `runtime/claude-code/`: `hook-handler.ts`,
`install.ts`, `mappers/*.ts`, `config.ts`, `session-resolver.ts`,
`session-store.ts`, `activity-types.ts`, `logger.ts`.
