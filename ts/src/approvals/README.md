# `openbox-sdk/approvals`

Pure helpers for rendering approval rows across every consumer surface
(mobile, web, IDE extensions, CLI). One canonical implementation per
helper; consumers drop their hand-rolled copies and import from here.

## What's shared

| Sub-module | Exports                                                      |
|------------|--------------------------------------------------------------|
| `format`   | `formatLabel`, `verdictLabel`, `UPPERCASE_WORDS`             |
| `summarize`| `summarizeInput`                                             |
| `status`   | `statusOf`, `SectionStatus`, `ApprovalBucket`                |
| `tier`     | `tierColor`, `tierBg`                                        |
| `time`     | `timeAgo`, `timeRemaining`                                   |
| `filters`  | `FilterState`, `DateRangeKey`, `EMPTY_FILTERS`, `applyClientFilters`, `dateRangeBounds`, `hasActiveFilters`, `summarizeFilters` |

Dev-only fixtures (mock profile / agents / approvals / helpers) ride on
a separate sub-path:

```ts
import { mockProfile, getMockApprovals } from 'openbox-sdk/approvals/mocks';
```

## What's not shared

These stay per-consumer because they require a platform runtime:

- Persistence of `FilterState` (vscode `Memento`, React Native `AsyncStorage`,
  browser `localStorage`, etc.).
- Style wrappers around `tierColor` / `tierBg` (RN `ViewStyle`,
  CSS-in-JS, VS Code `ThemeColor`).
- Tick scheduler that drives `timeAgo` / `timeRemaining` re-renders.
  The helpers read `Date.now()` on every call; consumers wire up
  whatever 1Hz mechanism their UI framework supports.

## Pinning behavior

`formatLabel` looks up `CANONICAL_ACTIVITY_LABELS` (from
`openbox-sdk/core-client`) first; the spec table is the single source
of truth. The fallback handles free-form custom-preset activity types
with two regex passes so acronyms like `MCPToolCall` render as
`MCP Tool Call`, not `Mcptool Call`.

`statusOf` is a 4-bucket classifier (`approved` / `rejected` / `expired`
/ `pending`). Precedence:

1. Explicit wire `status` field if present.
2. `decided_at` set + verdict 0/1 → approved; verdict 3/4 → rejected.
3. `decided_at` unset + `approval_expired_at` past → expired.
4. Otherwise pending.

The timestamp-fallback branch (3) is load-bearing for fixtures and
backends that emit `verdict=2 + decided_at=null + approval_expired_at`
without a synthesized `status` field.
