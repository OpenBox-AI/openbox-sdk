// Coverage for pickApproval — the resolver every approve/reject/openDetail
// command runs incoming arguments through. Three call shapes exist in
// the user-facing flow (tree node, plain Approval, bare id string)
// plus one optional fallback (preWriteGate's modal button).

import { describe, it, expect } from 'vitest';
import { pickApproval } from './pickApproval';
import type { Approval } from './types';

const make = (id: string): Approval => ({
  id,
  agent_id: 'agent-x',
  status: 'pending',
  activity_type: 'ShellExecution',
  verdict: 2,
  reason: '',
  created_at: new Date().toISOString(),
});

const lookup = {
  pending: [make('p1'), make('p2')],
  history: [make('h1'), make('h2')],
};

describe('pickApproval', () => {
  it('undefined input → undefined', () => {
    expect(pickApproval(undefined, lookup)).toBeUndefined();
  });

  it('null input → undefined', () => {
    expect(pickApproval(null, lookup)).toBeUndefined();
  });

  it('empty string → undefined (no row matches)', () => {
    // Empty string is technically a string but no id matches; the
    // pending+history walk both miss, ?? falls through.
    expect(pickApproval('', lookup)).toBeUndefined();
  });

  it('bare id matches a pending row', () => {
    const r = pickApproval('p1', lookup);
    expect(r?.id).toBe('p1');
  });

  it('bare id matches a history row when not in pending', () => {
    const r = pickApproval('h2', lookup);
    expect(r?.id).toBe('h2');
  });

  it('bare id with no match returns undefined', () => {
    expect(pickApproval('does-not-exist', lookup)).toBeUndefined();
  });

  it('tree-node-shaped object: { approval } returns the inner approval', () => {
    const node = { approval: make('tree-row'), label: 'foo' };
    const r = pickApproval(node, lookup);
    expect(r?.id).toBe('tree-row');
  });

  it('plain Approval-shaped object with id: returns it as-is', () => {
    const a = make('inline');
    const r = pickApproval(a, lookup);
    expect(r?.id).toBe('inline');
  });

  it('object with neither approval nor id: undefined', () => {
    expect(pickApproval({ foo: 'bar' }, lookup)).toBeUndefined();
  });

  it('falls through pending → history in order (pending wins on duplicate id)', () => {
    const dup = {
      pending: [make('shared')],
      history: [make('shared')],
    };
    const r = pickApproval('shared', dup);
    expect(r).toBe(dup.pending[0]);
  });

  it('empty lookup state: bare id always undefined', () => {
    const empty = { pending: [], history: [] };
    expect(pickApproval('x', empty)).toBeUndefined();
  });
});
