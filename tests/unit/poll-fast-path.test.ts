// Verifies the awaitExternalDecision fast path: when an external
// signal (e.g. a local IPC socket from the OpenBox extension) arrives
// before the next exponential-backoff tick, pollApproval wakes
// immediately and runs one confirmatory backend poll. Without the
// race, the hook subprocess waits up to approvalPollIntervalMs for
// the first tick (500ms default) and up to approvalPollMaxIntervalMs
// (5s default) at steady state.

import { describe, expect, test, vi } from 'vitest';
import { govern } from '../../ts/src/core-client/generated/govern.js';
import { presets } from '../../ts/src/core-client/generated/govern.js';

function fakeCore(plan: Array<{ action?: string; reason?: string }>) {
  let i = 0;
  return {
    pollApproval: vi.fn(async () => {
      const r = plan[Math.min(i, plan.length - 1)];
      i += 1;
      return r;
    }),
    // The runtime calls `core.evaluate()` to fire each activity to the
    // backend. Stub it to immediately return a require_approval verdict
    // so the SDK falls straight into the poll loop where the fast path
    // matters.
    evaluate: vi.fn(async () => ({
      action: 'require_approval',
      decision_id: 'd1',
      governance_event_id: 'g1',
      approval_id: 'a1',
      approval_expiration_time: new Date(Date.now() + 60_000).toISOString(),
    })),
  } as unknown as Parameters<typeof govern.attach>[0]['core'];
}

describe('awaitExternalDecision fast path', () => {
  test('external decision races against poll interval and wakes early', async () => {
    // Plan: backend says require_approval on first poll, then allow.
    // External signal fires after 50ms — orders of magnitude before
    // the 500ms first tick.
    const core = fakeCore([
      { action: 'require_approval' },
      { action: 'allow' },
    ]);
    let externalFired = false;
    const externalDecision = new Promise<'approve'>((resolve) => {
      setTimeout(() => {
        externalFired = true;
        resolve('approve');
      }, 50);
    });

    const session = govern.attach({
      core,
      preset: presets.custom,
      workflowId: 'w',
      runId: 'r',
      approvalPollIntervalMs: 500,
      approvalMaxWaitMs: 10_000,
      awaitExternalDecision: () => externalDecision,
    });

    const t0 = Date.now();
    const verdict = await session.activity('ActivityStarted', 'Test', {
      input: [{ x: 1 }],
    });
    const elapsed = Date.now() - t0;

    expect(verdict.arm).toBe('allow');
    expect(externalFired).toBe(true);
    // Without the fast path, the loop would sleep 500ms + jitter on
    // the first tick before polling. With the race, the external
    // signal at 50ms wakes us and we poll right away. Use 250ms as a
    // generous ceiling that's still well under the full 500ms tick.
    expect(elapsed).toBeLessThan(250);
  });

  test('no external decision → loop falls back to normal interval', async () => {
    const core = fakeCore([
      { action: 'require_approval' },
      { action: 'allow' },
    ]);
    const session = govern.attach({
      core,
      preset: presets.custom,
      workflowId: 'w2',
      runId: 'r2',
      approvalPollIntervalMs: 100,
      approvalMaxWaitMs: 5_000,
    });

    const t0 = Date.now();
    const verdict = await session.activity('ActivityStarted', 'Test', {
      input: [{ x: 1 }],
    });
    const elapsed = Date.now() - t0;

    expect(verdict.arm).toBe('allow');
    // Without the fast path we sleep at least the first interval
    // (100ms ± jitter) before the first poll catches the decision.
    expect(elapsed).toBeGreaterThanOrEqual(50);
  });
});
