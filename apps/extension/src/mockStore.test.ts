// Coverage for the in-memory MockStore that backs openbox.mockAuth=true.
//
// MockStore is a singleton; reset() must restore canonical state on
// demand because the user reloads it via "Reset Mock Data" and the
// downstream UI expects ids `mock-appr-001`..`mock-appr-006` to map
// to the same activity_type set every time.

import { describe, it, expect, beforeEach } from 'vitest';
import { mockStore } from './mockStore';

describe('mockStore - canonical fixtures', () => {
  beforeEach(() => {
    mockStore().reset();
  });

  it('reset seeds 6 pending rows with zero-padded mock-appr-NNN ids', () => {
    const pending = mockStore().list('pending');
    expect(pending).toHaveLength(6);
    expect(pending.map((a) => a.id)).toEqual([
      'mock-appr-001', 'mock-appr-002', 'mock-appr-003',
      'mock-appr-004', 'mock-appr-005', 'mock-appr-006',
    ]);
  });

  it('reset seeds 5 decided rows across approved/rejected/expired', () => {
    const counts = mockStore().counts();
    expect(counts.pending).toBe(6);
    expect(counts.approved).toBe(2);
    expect(counts.rejected).toBe(1);
    expect(counts.expired).toBe(2);
  });

  it('every pending fixture carries verdict=2 (require_approval)', () => {
    for (const a of mockStore().list('pending')) {
      expect(a.status).toBe('pending');
      expect(a.verdict).toBe(2);
      expect(a.decided_at).toBeUndefined();
      expect(a.approval_expired_at).toBeDefined();
    }
  });

  it('decided rows carry the correct verdict per status', () => {
    const approved = mockStore().list('approved');
    const rejected = mockStore().list('rejected');
    const expired = mockStore().list('expired');
    for (const a of approved) expect(a.verdict).toBe(0);
    for (const a of rejected) expect(a.verdict).toBe(3);
    for (const a of expired) expect(a.verdict).toBe(2); // expired keeps verdict=2 (mirrors mobile)
  });

  it('list() with no arg returns pending + decided combined', () => {
    const all = mockStore().list(undefined);
    expect(all.length).toBe(6 + 5);
  });

  it('every fixture has a non-empty reason and an activity_type', () => {
    for (const a of mockStore().list(undefined)) {
      expect(a.reason).toBeTruthy();
      expect(a.activity_type).toBeTruthy();
    }
  });

  it('fixtures cover the 6 representative activity types', () => {
    const types = mockStore().list('pending').map((a) => a.activity_type);
    expect(new Set(types)).toEqual(new Set([
      'ShellExecution', 'FileEdit', 'HTTPRequest', 'MCPToolCall',
      'PromptSubmission', 'FileDelete',
    ]));
  });
});

describe('mockStore - decide()', () => {
  beforeEach(() => {
    mockStore().reset();
  });

  it('approve removes from pending, adds to decided as approved', () => {
    const ok = mockStore().decide('mock-appr-001', 'approve');
    expect(ok).toBe(true);
    const counts = mockStore().counts();
    expect(counts.pending).toBe(5);
    expect(counts.approved).toBe(3); // 2 seeded + 1 new
    const approved = mockStore().list('approved');
    expect(approved[0].id).toBe('mock-appr-001');
    expect(approved[0].verdict).toBe(0);
    expect(approved[0].decided_at).toBeDefined();
    expect(approved[0].approval_expired_at).toBeUndefined();
  });

  it('reject removes from pending, adds to decided as rejected', () => {
    const ok = mockStore().decide('mock-appr-002', 'reject');
    expect(ok).toBe(true);
    const counts = mockStore().counts();
    expect(counts.pending).toBe(5);
    expect(counts.rejected).toBe(2); // 1 seeded + 1 new
    const rejected = mockStore().list('rejected');
    expect(rejected[0].id).toBe('mock-appr-002');
    expect(rejected[0].verdict).toBe(3);
  });

  it('decide on unknown id returns false, no state change', () => {
    const beforeCount = mockStore().counts();
    const ok = mockStore().decide('mock-appr-does-not-exist', 'approve');
    expect(ok).toBe(false);
    expect(mockStore().counts()).toEqual(beforeCount);
  });

  it('draining all 6 pending leaves counts.pending=0', () => {
    for (let i = 1; i <= 6; i++) {
      mockStore().decide(`mock-appr-${String(i).padStart(3, '0')}`, 'approve');
    }
    expect(mockStore().counts().pending).toBe(0);
  });

  it('decided rows are unshifted (newest first)', () => {
    mockStore().decide('mock-appr-001', 'approve');
    mockStore().decide('mock-appr-003', 'approve');
    const approved = mockStore().list('approved');
    expect(approved[0].id).toBe('mock-appr-003'); // most recent
    expect(approved[1].id).toBe('mock-appr-001');
  });

  it('reset after decide restores the canonical 6-pending baseline', () => {
    mockStore().decide('mock-appr-001', 'approve');
    mockStore().decide('mock-appr-002', 'reject');
    expect(mockStore().counts().pending).toBe(4);
    mockStore().reset();
    expect(mockStore().counts().pending).toBe(6);
    expect(mockStore().counts().approved).toBe(2);
    expect(mockStore().counts().rejected).toBe(1);
  });
});

describe('mockStore - seed()', () => {
  beforeEach(() => {
    mockStore().reset();
  });

  it('seed(N) appends N pending rows with fresh ordinal ids', () => {
    mockStore().seed(3);
    const pending = mockStore().list('pending');
    expect(pending).toHaveLength(9);
    // New ids start at 007 (after the 6 seeded canonical rows).
    const newIds = pending.slice(0, 3).map((a) => a.id);
    expect(newIds).toEqual(['mock-appr-009', 'mock-appr-008', 'mock-appr-007']);
  });

  it('seed defaults to 3', () => {
    mockStore().seed();
    expect(mockStore().counts().pending).toBe(9);
  });

  it('seeded rows are inserted at the head (newest first)', () => {
    mockStore().seed(1);
    const pending = mockStore().list('pending');
    expect(pending[0].id).toBe('mock-appr-007');
  });
});

describe('mockStore - profile / members / teams / agents', () => {
  it('profile mirrors the X-API-Key UserEntity shape (no email, isApiKeyAuth: true)', () => {
    const p = mockStore().profile();
    expect(p.email).toBeUndefined();
    expect(p.isApiKeyAuth).toBe(true);
    expect(p.sub).toMatch(/^api-key:/);
    expect(p.orgId).toBe('mock-org-001');
    expect(Array.isArray(p.permissions)).toBe(true);
    expect(p.permissions.length).toBeGreaterThan(0);
  });

  it('members list is non-empty', () => {
    expect(mockStore().members().length).toBeGreaterThan(0);
  });

  it('teams list is non-empty', () => {
    expect(mockStore().teams().length).toBeGreaterThan(0);
  });

  it('agents map is non-empty', () => {
    expect(Object.keys(mockStore().agents()).length).toBeGreaterThan(0);
  });
});
