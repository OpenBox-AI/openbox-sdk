# Migration: openbox-mobile → openbox-sdk consumer-shared modules

This branch (`feat/consumer-shared-sdk`) lifts approvals helpers, types,
client construction, and the polling loop into the SDK as the single
source of truth. Mobile holds independent copies of each; this doc is
the patch list to delete those copies and import from the SDK once the
SDK release is tagged.

**Do not apply until the SDK ships a new tag past `v0.1.0-alpha.1`** —
mobile's `package.json` pins to a specific tag and the new sub-paths
won't resolve before the bump.

## 1. `src/lib/format.ts` → re-export from SDK

```diff
- const UPPERCASE_WORDS = new Set([ /* …large list… */ ]);
-
- export function formatLabel(s?: string | null): string { /* …~50 LOC… */ }
-
- export function summarizeInput(/* … */) { /* …~80 LOC… */ }
+ export {
+   formatLabel,
+   summarizeInput,
+   verdictLabel,
+   UPPERCASE_WORDS,
+ } from 'openbox-sdk/approvals';
```

The mobile copy was the original donor for the SDK extraction (see
`feat(approvals): extract shared formatters and fixtures` commit), so
behavior is verbatim.

## 2. `src/lib/time.ts` → re-export from SDK

```diff
- export function timeAgo(createdAt?: string | null): string { /* … */ }
- export function timeRemaining(expiresAt?: string | null): string { /* … */ }
+ export { timeAgo, timeRemaining } from 'openbox-sdk/approvals';
```

The SDK uses a 3-second `"just now"` threshold (matches mobile's
existing behavior). Extension's old <60s threshold has been swapped to
match.

## 3. `src/types/api.ts` → import from SDK

```diff
- export type UserProfile = { orgId?: string; email?: string; preferred_username?: string; sub?: string; };
- export type ApprovalAgent = { agent_name: string; };
- export type ApprovalMetadata = { trust_tier?: number; };
- export type Approval = { /* …local subset… */ };
- export const VERDICT_LABELS: Record<number, string> = { /* … */ };
+ export type { Approval, UserProfile, Agent, Member, Team } from 'openbox-sdk/types';
+ export { verdictLabel as VERDICT_LABELS } from 'openbox-sdk/approvals';
```

Note: the SDK `Approval` is wider than mobile's local subset (fully
spec-generated). Reads of fields mobile already used remain
type-correct; new fields become available at no cost.

If `VERDICT_LABELS` is referenced as a record (e.g.
`VERDICT_LABELS[a.verdict]`) keep a local thin shim:

```ts
import { verdictLabel } from 'openbox-sdk/approvals';
export const VERDICT_LABELS = new Proxy({} as Record<number, string>, {
  get: (_, key) => verdictLabel(Number(key)) ?? '',
});
```

…or refactor each call site to `verdictLabel(a.verdict)`. Latter is
preferred.

## 4. `src/hooks/useApprovals.ts` → adopt `statusOf()`

```diff
- function isExpired(a: Approval, now: number): boolean {
-   return (
-     a.verdict === 2 &&
-     !!a.approval_expired_at &&
-     new Date(a.approval_expired_at).getTime() < now
-   );
- }
+ import { statusOf } from 'openbox-sdk/approvals';
+ const isExpired = (a: Approval) => statusOf(a) === 'expired';
```

`statusOf()` returns `'pending' | 'expired' | 'decided'`. The check
flips from "is this row past its expiry?" to "what bucket is this row
in?" — same outcome, broader vocabulary for the bucket sweep.

## 5. `src/api/client.ts` → adopt `createConsumerClient` (optional, big)

The SDK now exposes `createConsumerClient` at `openbox-sdk/client-factory`.
Mobile's bespoke client init can collapse to:

```ts
import { createConsumerClient } from 'openbox-sdk/client-factory';
import * as SecureStore from 'expo-secure-store';

async function buildClient(envName: EnvName) {
  return createConsumerClient({
    envName,
    getApiKey: () => SecureStore.getItemAsync(`api-key.${envName}`),
    clientName: 'apps/mobile',
    timeoutMs: undefined,
  });
}
```

This is a load-bearing change — mobile's existing `client.ts` includes
token-refresh callbacks and env-keyed caching that the factory doesn't
cover yet. Hold this migration until the SDK factory grows
`onTokenRefresh` (TODO; tracked separately) OR stage it behind a
feature flag and verify approval flows on a TestFlight build first.

## 6. `src/lib/approvalsCache.ts` — leave consumer-owned

Session-persistent cross-tab cache; mobile-specific. Not a candidate for
SDK extraction.

## 7. `src/lib/realtime.ts`, `src/lib/approvalEvents.ts`, `src/lib/timeTick.ts` — leave consumer-owned

WebSocket subscriptions + 1Hz tick + decided/expired event emitter.
Mobile's React-coupled orchestration; no current need to share with
extension or CLI.

## Order of operations

1. Tag SDK release including this branch's exports
   (`openbox-sdk/client-factory`, `openbox-sdk/file-tokens`,
   `openbox-sdk/polling`).
2. Bump `openbox-sdk` git tag in mobile's `package.json`.
3. Apply sections 1-4 (safe, mechanical).
4. Smoke-test on TestFlight: approval list renders, formatters look
   right, expired sweep works.
5. Section 5 lands separately once factory grows token-refresh hooks.

## Verification

After applying 1-4, run:

```
cd ~/workspace/openbox-mobile
bun install
bun run typecheck
```

Expect zero new type errors. Visual diff on the approval list +
expired sweep is the only end-to-end check.
