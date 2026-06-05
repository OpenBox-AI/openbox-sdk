# `runtime/cursor/`: OpenBox SDK ↔ Cursor IDE

Mirror of `runtime/claude-code/` for [Cursor IDE](https://cursor.com).
Same two surfaces: `createCursorAdapter` (spec-emitted) +
`openbox cursor {install,hook}` (platform integration).

## Differences from claude-code

- Cursor's `before*` events are gating. Verdict shape is
  `cursor-permission`: `{ permission: 'allow' | 'deny', user_message?,
  agent_message? }` (snake_case per cursor.com/docs/hooks).
- `beforeSubmitPrompt` uses `cursor-continue`: `{ continue: boolean,
  user_message? }`.
- Cursor's `after*` events are observe-only (`cursor-observe`, `{}`).
- Session id is `conversation_id`, not `session_id`.
- Cursor fires both `preToolUse` AND the matching specialized
  `before*` event (e.g. `beforeShellExecution`) for one tool
  invocation. The dedup claim in `runtime/cursor/dedup.ts` makes
  one subprocess win the gate while the loser waits for the
  published verdict and mirrors it. Both block until consent is
  real. (Cursor-only; not in SDK because no other host fires the
  same event twice.)

## Shared with claude-code

See `runtime/claude-code/README.md`. The per-host code here is just
envelope binding, before/after handler wiring, and the cursor-specific
toast / approval-socket flow.
