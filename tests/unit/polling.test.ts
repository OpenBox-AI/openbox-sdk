// Coverage for PollingService; the layer that drives the approvals
// feed: cold-seeding, brand-new detection, load-more page suppression,
// changed-event semantics. Used to be exercised only end-to-end in
// the wdio mock-toast suite (which observed showWarningMessage fire);
// extracting it as a unit test means we no longer need a workbench
// to assert seed gating + brand-new detection.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApprovalsPollingService as PollingService } from '../../ts/src/polling/index.js';
import type { Approval } from '../../ts/src/types/index.js';

function row(id: string): Approval {
  return {
    id,
    agent_id: 'agent-x',
    status: 'pending',
    activity_type: 'ShellExecution',
    verdict: 2,
    reason: '',
    created_at: new Date().toISOString(),
  };
}

interface FakeClient {
  getOrgApprovals: ReturnType<typeof vi.fn>;
}

function makeClient(scriptedReturns: Approval[][]): FakeClient {
  let i = 0;
  return {
    getOrgApprovals: vi.fn(async () => {
      const data = scriptedReturns[Math.min(i, scriptedReturns.length - 1)] ?? [];
      i += 1;
      return { approvals: { data } };
    }),
  };
}

describe('PollingService - seed gating', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('first poll never emits newApprovals (cold seed); subsequent poll with new ids does', async () => {
    const client = makeClient([
      [row('a'), row('b')],            // first poll: seeding
      [row('a'), row('b'), row('c')],  // second poll: 'c' is brand new
    ]);
    const svc = new PollingService(client as unknown as never, 'org-1', { intervalMs: 100 });

    const seen: { event: string; payload: Approval[] }[] = [];
    svc.on('newApprovals', (p: Approval[]) => seen.push({ event: 'newApprovals', payload: p }));
    svc.on('changed', (p: Approval[]) => seen.push({ event: 'changed', payload: p }));

    svc.start();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    // First poll: a 'changed' fired (start emits empty, then real one
    // post-fetch); no newApprovals.
    const newAfterFirst = seen.filter((e) => e.event === 'newApprovals');
    expect(newAfterFirst).toHaveLength(0);

    // Drive a second poll and let the await settle.
    await svc.refresh();
    await Promise.resolve();

    const newAfterSecond = seen.filter((e) => e.event === 'newApprovals');
    expect(newAfterSecond).toHaveLength(1);
    expect(newAfterSecond[0].payload.map((a) => a.id)).toEqual(['c']);

    svc.stop();
  });

  it('changed event does fire for the cold seed (so views render initial rows)', async () => {
    const client = makeClient([[row('a'), row('b')]]);
    const svc = new PollingService(client as unknown as never, 'org-1', { intervalMs: 100 });
    const changed: Approval[][] = [];
    svc.on('changed', (p: Approval[]) => changed.push(p));

    svc.start();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    // Two changed: the start() empty-array prime + the post-fetch
    // emission with real rows.
    expect(changed.length).toBeGreaterThanOrEqual(2);
    expect(changed.at(-1)?.map((a) => a.id)).toEqual(['a', 'b']);

    svc.stop();
  });

  it('repeated identical poll does NOT re-emit changed (id set unchanged)', async () => {
    const client = makeClient([
      [row('a'), row('b')],
      [row('a'), row('b')],
    ]);
    const svc = new PollingService(client as unknown as never, 'org-1', { intervalMs: 100 });
    const changed: Approval[][] = [];
    svc.on('changed', (p: Approval[]) => changed.push(p));

    svc.start();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const countAfterFirstFetch = changed.length;

    await svc.refresh();
    await Promise.resolve();
    // Second poll has the same ids: no new 'changed' emission since
    // the only emit triggers are (a) seed completion (first time) or
    // (b) id set drift.
    expect(changed.length).toBe(countAfterFirstFetch);

    svc.stop();
  });
});

describe('PollingService - load-more / brand-new suppression', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('loadMore() suppresses newApprovals for the immediately-following poll', async () => {
    const client = makeClient([
      [row('a'), row('b')],                         // initial seed
      [row('a'), row('b'), row('c'), row('d')],     // load-more: c,d are NOT new arrivals
      [row('a'), row('b'), row('c'), row('d'), row('e')], // genuine arrival: e is new
    ]);
    const svc = new PollingService(client as unknown as never, 'org-1', { intervalMs: 100 });
    const newOnes: Approval[][] = [];
    svc.on('newApprovals', (p: Approval[]) => newOnes.push(p));

    svc.start();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    svc.loadMore();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    // c, d came in via load-more → no toast.
    expect(newOnes).toHaveLength(0);

    await svc.refresh();
    await Promise.resolve();
    // e arrived in a normal poll after load-more cleared.
    expect(newOnes).toHaveLength(1);
    expect(newOnes[0].map((a) => a.id)).toEqual(['e']);

    svc.stop();
  });

  it('loadMore() respects MAX_PAGES (5 pages); past the cap, no further effect', () => {
    const client = makeClient([[row('a')]]);
    const svc = new PollingService(client as unknown as never, 'org-1');
    for (let i = 0; i < 10; i++) svc.loadMore();
    expect(svc.atPageLimit).toBe(true);
  });
});

describe('PollingService - filter/status reset semantics', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('setStatus() clears seeded so the post-status-change rows are NOT toasted as new', async () => {
    const client = makeClient([
      [row('a')],          // seed under default status
      [row('b'), row('c')], // post-setStatus poll: must NOT toast b/c
    ]);
    const svc = new PollingService(client as unknown as never, 'org-1', { intervalMs: 100 });
    const newOnes: Approval[][] = [];
    svc.on('newApprovals', (p: Approval[]) => newOnes.push(p));

    svc.start();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(newOnes).toHaveLength(0); // cold seed

    svc.setStatus('pending');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    // setStatus reset seeded, so the next poll re-seeds: still no toast.
    expect(newOnes).toHaveLength(0);

    svc.stop();
  });

  it('setFilters() also resets seeding', async () => {
    const client = makeClient([
      [row('a')],
      [row('b')],
    ]);
    const svc = new PollingService(client as unknown as never, 'org-1', { intervalMs: 100 });
    const newOnes: Approval[][] = [];
    svc.on('newApprovals', (p: Approval[]) => newOnes.push(p));

    svc.start();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    svc.setFilters({ sort: 'oldest', dateRange: 'all' });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(newOnes).toHaveLength(0); // re-seed after filter change

    svc.stop();
  });
});

describe('PollingService - error handling', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('thrown error from getOrgApprovals emits "error" and increments errorCount', async () => {
    const client = {
      getOrgApprovals: vi.fn(async () => { throw new Error('network down'); }),
    };
    const svc = new PollingService(client as unknown as never, 'org-1', { intervalMs: 100 });
    const errs: Error[] = [];
    svc.on('error', (e: Error) => errs.push(e));

    svc.start();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].message).toMatch(/network down/);
    expect(svc.errorCount).toBeGreaterThanOrEqual(1);
    expect(svc.lastErrorMessage).toMatch(/network down/);

    svc.stop();
  });
});
