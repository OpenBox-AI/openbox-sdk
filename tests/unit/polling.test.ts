import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApprovalsPollingService } from '../../ts/src/polling/index.js';

interface MinimalClient {
  getOrgApprovals: ReturnType<typeof vi.fn>;
}

function makeApproval(id: string) {
  return { id, agent_id: 'a', activity_type: 't', verdict: 0 };
}

function makeClient(pages: Array<Array<{ id: string }>>): MinimalClient {
  let i = 0;
  return {
    getOrgApprovals: vi.fn(async () => {
      const data = pages[Math.min(i, pages.length - 1)];
      i++;
      return { approvals: { data } };
    }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ApprovalsPollingService', () => {
  it('emits initial empty changed before the first network round-trip', async () => {
    const client = makeClient([[]]);
    const svc = new ApprovalsPollingService(client as never, 'org_x');
    const seen: number[] = [];
    svc.on('changed', (a: unknown[]) => seen.push(a.length));
    svc.start();
    expect(seen[0]).toBe(0);
    svc.stop();
  });

  it('does NOT fire newApprovals on cold start (existing rows are not "new")', async () => {
    const client = makeClient([[makeApproval('a'), makeApproval('b')]]);
    const svc = new ApprovalsPollingService(client as never, 'org_x');
    let newApprovalsFired = false;
    svc.on('newApprovals', () => { newApprovalsFired = true; });
    svc.start();
    await vi.runOnlyPendingTimersAsync();
    expect(newApprovalsFired).toBe(false);
    svc.stop();
  });

  it('fires newApprovals on subsequent polls when an unseen row appears', async () => {
    const client = makeClient([
      [makeApproval('a')],
      [makeApproval('a'), makeApproval('b')],
    ]);
    const svc = new ApprovalsPollingService(client as never, 'org_x', { intervalMs: 100 });
    const newOnes: string[][] = [];
    svc.on('newApprovals', (a: Array<{ id: string }>) => newOnes.push(a.map((x) => x.id)));
    svc.start();
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(100);
    await vi.runOnlyPendingTimersAsync();
    expect(newOnes).toEqual([['b']]);
    svc.stop();
  });

  it('emits changed when the set shrinks (an approval was decided away)', async () => {
    const client = makeClient([
      [makeApproval('a'), makeApproval('b')],
      [makeApproval('a')],
    ]);
    const svc = new ApprovalsPollingService(client as never, 'org_x', { intervalMs: 100 });
    const sizes: number[] = [];
    svc.on('changed', (a: unknown[]) => sizes.push(a.length));
    svc.start();
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(100);
    await vi.runOnlyPendingTimersAsync();
    // [empty initial, 2 rows after first poll, 1 row after second poll]
    expect(sizes).toEqual([0, 2, 1]);
    svc.stop();
  });

  it('emits error when the API throws, and keeps polling', async () => {
    let throwCount = 0;
    const client: MinimalClient = {
      getOrgApprovals: vi.fn(async () => {
        if (throwCount++ === 0) throw new Error('boom');
        return { approvals: { data: [] } };
      }),
    };
    const svc = new ApprovalsPollingService(client as never, 'org_x', { intervalMs: 100 });
    const errors: Error[] = [];
    svc.on('error', (e: Error) => errors.push(e));
    svc.start();
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(100);
    await vi.runOnlyPendingTimersAsync();
    expect(errors.length).toBe(1);
    expect(errors[0].message).toBe('boom');
    svc.stop();
  });

  it('refresh forces an immediate poll', async () => {
    const client = makeClient([[makeApproval('a')]]);
    const svc = new ApprovalsPollingService(client as never, 'org_x');
    const sizes: number[] = [];
    svc.on('changed', (a: unknown[]) => sizes.push(a.length));
    svc.start();
    await svc.refresh();
    // initial empty changed + first poll + refresh poll (the second
    // refresh poll sees no diff so no new "changed" fires)
    expect(sizes[0]).toBe(0);
    expect(sizes[1]).toBe(1);
    svc.stop();
  });
});
