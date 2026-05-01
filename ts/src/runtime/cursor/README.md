# `runtime/cursor/`: OpenBox SDK ↔ Cursor IDE

Mirror of `runtime/claude-code/` for [Cursor IDE](https://cursor.com).
Two surfaces, both via `import ... from 'openbox-sdk/runtime/cursor'`.

## 1. Adapter primitive, spec-emitted

Re-exported from the auto-generated
`ts/src/core-client/generated/runtime/cursor.ts`. The adapter is
driven by `@adapter("cursor", "cursor", "hook_event_name")` in
`specs/typespec/govern/adapters.tsp`.

```ts
import { createCursorAdapter } from 'openbox-sdk/runtime/cursor';
```

## 2. Platform integration

Used by `openbox cursor install`, which writes
`~/.cursor/hooks.json`, and by `openbox cursor hook`, the per-event
handler.

Differences from claude-code:

- Cursor's `before*` events are gating. Verdict shape is
  `cursor-permission`:
  `{ permission: 'allow' | 'deny', userMessage?, agentMessage? }`.
- Cursor's `after*` events are observe-only. Verdict shape is
  `cursor-observe`: empty `{}` stdout.
- Session ID is `conversation_id`, not `session_id`.
- Cursor 3.x's `preToolUse` is the primary tool-routing hook.
  `beforeShellExecution` and `beforeReadFile` only fire in cmd-k or
  duplicate coverage of `preToolUse`. The integration treats
  `preToolUse` as authoritative and lets the others pass through.

Same module structure as `runtime/claude-code/`: `hook-handler.ts`,
`install.ts`, `mappers/*.ts`, `config.ts`, `session-resolver.ts`,
`session-store.ts`, `activity-types.ts`, `logger.ts`.
