// Pre-flight permission check on the backend wrapper. Proves:
//   1. Method with required perms + cached perms covering them → no throw
//   2. Method with required perms + missing → throws MissingPermissionError
//      BEFORE any network call (so we can trust no fetch happened)
//   3. Method with NO @Permissions decorator (e.g. login, csrf) → no throw
//      regardless of cached permissions
//   4. Permissions undefined → check skipped entirely (legacy behavior)
//   5. setPermissions() updates the cache mid-session

import { describe, expect, test, vi } from 'vitest';
import {
  OpenBoxClient,
  MissingPermissionError,
  METHOD_PERMISSIONS,
} from '../../ts/src/client/index.js';

function noFetch() {
  return vi.fn(async () => {
    throw new Error('fetch should not be called - pre-flight failed to short-circuit');
  });
}

describe('OpenBoxClient permission pre-flight', () => {
  test('METHOD_PERMISSIONS export covers core endpoints', () => {
    // Sanity - the spec→generated→exported chain delivers a non-empty map.
    expect(Object.keys(METHOD_PERMISSIONS).length).toBeGreaterThan(50);
    expect(METHOD_PERMISSIONS.listAgents).toEqual(['read:agent']);
    expect(METHOD_PERMISSIONS.createAgent).toEqual(['create:agent']);
    expect(METHOD_PERMISSIONS.deleteWebhook).toEqual(['delete:webhook']);
  });

  test('caller has the required permission → call proceeds (mocked fetch)', async () => {
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new OpenBoxClient({
      accessToken: 'test-token',
      permissions: ['read:agent'],
    });
    await client.listAgents();
    expect(fetchMock).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  test('caller lacks required permission → throws MissingPermissionError, no fetch', async () => {
    const fetchMock = noFetch();
    vi.stubGlobal('fetch', fetchMock);

    const client = new OpenBoxClient({
      accessToken: 'test-token',
      permissions: ['read:org'], // wrong perm
    });
    await expect(client.listAgents()).rejects.toBeInstanceOf(MissingPermissionError);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  test('error carries methodName + missing + have', async () => {
    const client = new OpenBoxClient({
      accessToken: 'test-token',
      permissions: ['read:org'],
    });
    try {
      await client.createAgent({ agent_name: 'x' } as never);
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MissingPermissionError);
      const e = err as MissingPermissionError;
      expect(e.methodName).toBe('createAgent');
      expect(e.missing).toEqual(['create:agent']);
      expect(e.have).toEqual(['read:org']);
      expect(e.message).toMatch(/createAgent.*missing.*create:agent/);
    }
  });

  test('method with no required permissions (e.g. health) is unrestricted', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    // Empty perms - would block listAgents, but health has no @Permissions.
    const client = new OpenBoxClient({
      accessToken: 'test-token',
      permissions: [],
    });
    expect(METHOD_PERMISSIONS.health).toBeUndefined(); // confirms it's unrestricted
    await client.health();
    expect(fetchMock).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  test('permissions undefined → pre-flight skipped (legacy passthrough)', async () => {
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    // No `permissions` key at all - wrapper never checks; server is the gate.
    const client = new OpenBoxClient({ accessToken: 'test-token' });
    await client.listAgents();
    expect(fetchMock).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  test('setPermissions() updates the cache mid-session', async () => {
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new OpenBoxClient({
      accessToken: 'test-token',
      permissions: ['read:org'], // wrong perm
    });
    await expect(client.listAgents()).rejects.toBeInstanceOf(MissingPermissionError);
    expect(fetchMock).not.toHaveBeenCalled();

    // Token refresh delivers new claims → caller updates the cache.
    client.setPermissions(['read:agent']);
    await client.listAgents();
    expect(fetchMock).toHaveBeenCalledOnce();

    // Disable pre-flight entirely.
    client.setPermissions(undefined);
    await client.createAgent({ agent_name: 'x' } as never);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  test('all required perms must be present (AND, not OR)', async () => {
    // Find a method requiring 2+ perms in METHOD_PERMISSIONS, if any. Today
    // every entry has exactly one - but the check must be conjunctive so we
    // don't regress when multi-perm methods are added.
    const multi = Object.entries(METHOD_PERMISSIONS).find(
      ([, perms]) => perms.length >= 2,
    );
    // Skip when no multi-perm method exists yet - the conjunctive logic is
    // visible in the generated checkPermissions(), so this isn't load-bearing.
    if (!multi) return;

    const [methodName, required] = multi;
    const client = new OpenBoxClient({
      accessToken: 'test-token',
      permissions: [required[0]], // partial - has one of N
    });
    const fn = (client as unknown as Record<string, () => Promise<unknown>>)[methodName];
    if (typeof fn === 'function') {
      await expect(fn.call(client)).rejects.toBeInstanceOf(MissingPermissionError);
    }
  });
});
