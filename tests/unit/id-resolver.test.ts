// Locks the short-ID resolver contract:
//   - full UUIDs pass through with no HTTP traffic
//   - prefix `2e6cee17` resolves to one full ID via listAgents
//   - prefix `2e6cee17-…` (truncation suffixes) gets normalised
//   - ambiguous prefix throws with candidates
//   - no match throws with a useful pointer
//   - unknown arg names pass through unchanged

import { describe, it, expect, vi } from 'vitest';

import {
  isFullUuid,
  looksLikeUuidPrefix,
  resolveOne,
  resolveArgs,
} from '../../ts/src/cli/id-resolver';

const FULL = '2e6cee17-6302-4e2b-90cb-052af7ed9346';
const OTHER = 'a01428ea-954a-48f8-beae-07360c9ec72a';

function fakeClient(rows: Array<{ id: string }>): {
  listAgents: ReturnType<typeof vi.fn>;
} {
  const listAgents = vi.fn(async (opts: { page: number; perPage: number }) => {
    if (opts.page > 0) return { data: [], total: rows.length };
    return { data: rows, total: rows.length };
  });
  return { listAgents } as never;
}

describe('isFullUuid', () => {
  it('accepts canonical lowercase uuid', () => {
    expect(isFullUuid(FULL)).toBe(true);
  });

  it('accepts uppercase uuid', () => {
    expect(isFullUuid(FULL.toUpperCase())).toBe(true);
  });

  it('rejects partial', () => {
    expect(isFullUuid('2e6cee17')).toBe(false);
    expect(isFullUuid('2e6cee17-6302-4e2b-90cb')).toBe(false);
  });

  it('rejects non-string', () => {
    expect(isFullUuid(123)).toBe(false);
    expect(isFullUuid(null)).toBe(false);
    expect(isFullUuid(undefined)).toBe(false);
  });
});

describe('looksLikeUuidPrefix', () => {
  it('accepts UUID-shaped prefixes', () => {
    expect(looksLikeUuidPrefix('2e6cee17')).toBe(true);
    expect(looksLikeUuidPrefix('2e6cee17-6302')).toBe(true);
    expect(looksLikeUuidPrefix('2e6cee17-6302-4e2b')).toBe(true);
    expect(looksLikeUuidPrefix('2e6cee17-…')).toBe(true);
    expect(looksLikeUuidPrefix('2e6cee17-6302-...')).toBe(true);
  });

  it('rejects non-UUID strings (test stubs, names, garbage)', () => {
    expect(looksLikeUuidPrefix('bad')).toBe(false); // < 4 chars
    expect(looksLikeUuidPrefix('a1')).toBe(false);
    expect(looksLikeUuidPrefix('bogus')).toBe(false); // non-hex char
    expect(looksLikeUuidPrefix('agent-1')).toBe(false); // non-hex chars
    expect(looksLikeUuidPrefix('Demo Finance Agent')).toBe(false);
    expect(looksLikeUuidPrefix('')).toBe(false);
  });

  it('rejects full UUIDs (a "prefix" should mean partial)', () => {
    expect(looksLikeUuidPrefix(FULL)).toBe(false);
  });
});

describe('resolveOne', () => {
  it('passes through full UUID without calling the client', async () => {
    const client = fakeClient([{ id: FULL }]);
    const out = await resolveOne('agentId', FULL, client as never, {});
    expect(out).toBe(FULL);
    expect(client.listAgents).not.toHaveBeenCalled();
  });

  it('resolves a prefix to the full ID via listAgents', async () => {
    const client = fakeClient([{ id: FULL }, { id: OTHER }]);
    const out = await resolveOne('agentId', '2e6cee17', client as never, {});
    expect(out).toBe(FULL);
    expect(client.listAgents).toHaveBeenCalledTimes(1);
  });

  it('normalises truncation markers (`prefix-…`, trailing dash)', async () => {
    const client = fakeClient([{ id: FULL }, { id: OTHER }]);
    const out = await resolveOne(
      'agentId',
      '2e6cee17-…',
      client as never,
      {},
    );
    expect(out).toBe(FULL);
  });

  it('normalises trailing whitespace + ellipsis', async () => {
    const client = fakeClient([{ id: FULL }, { id: OTHER }]);
    const out = await resolveOne(
      'agentId',
      '2e6cee17-6302-...',
      client as never,
      {},
    );
    expect(out).toBe(FULL);
  });

  it('throws with no-match message including the resource name', async () => {
    const client = fakeClient([{ id: OTHER }]);
    await expect(
      resolveOne('agentId', 'deadbeef', client as never, {}),
    ).rejects.toThrow(/no agent with id starting with 'deadbeef'/);
  });

  it('throws with ambiguous-prefix message listing candidates', async () => {
    const same = '2e6cee17-aaaa-bbbb-cccc-dddddddddddd';
    const client = fakeClient([{ id: FULL }, { id: same }]);
    await expect(
      resolveOne('agentId', '2e6cee17', client as never, {}),
    ).rejects.toThrow(/ambiguous agent prefix '2e6cee17'/);
  });

  it('passes through args with no resolver entry', async () => {
    const client = fakeClient([]);
    const out = await resolveOne(
      'somethingElse',
      'whatever-value',
      client as never,
      {},
    );
    expect(out).toBe('whatever-value');
    expect(client.listAgents).not.toHaveBeenCalled();
  });

  it('passes through non-string values unchanged', async () => {
    const client = fakeClient([]);
    expect(await resolveOne('agentId', 42, client as never, {})).toBe(42);
    expect(await resolveOne('agentId', null, client as never, {})).toBe(null);
  });

  it('passes through pure-noise input that looksLikeUuidPrefix rejects', async () => {
    // `'...'` has no leading hex and so fails the prefix-shape check
    // before we ever try to normalise it. Pre-resolver-shape behavior
    // (throw on empty prefix) is now handled at the upstream filter.
    const client = fakeClient([]);
    expect(await resolveOne('agentId', '...', client as never, {})).toBe('...');
    expect(client.listAgents).not.toHaveBeenCalled();
  });
});

describe('resolveArgs', () => {
  it('resolves every entry whose name has a resolver, leaves others alone', async () => {
    const client = fakeClient([{ id: FULL }, { id: OTHER }]);
    const out = await resolveArgs(
      { agentId: '2e6cee17', noun: 'banana', count: 3 },
      client as never,
    );
    expect(out).toEqual({
      agentId: FULL,
      noun: 'banana',
      count: 3,
    });
  });

  it('does not mutate the input map', async () => {
    const client = fakeClient([{ id: FULL }]);
    const input = { agentId: '2e6cee17' };
    const out = await resolveArgs(input, client as never);
    expect(input.agentId).toBe('2e6cee17');
    expect(out.agentId).toBe(FULL);
  });
});
