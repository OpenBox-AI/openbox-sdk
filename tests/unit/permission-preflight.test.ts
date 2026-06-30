// Pre-flight permission check on the backend wrapper. Proves:
//   1. Method with required perms + cached perms covering them →
//      no throw.
//   2. Method with required perms + missing → throws
//      MissingPermissionError BEFORE any network call, so we can
//      trust no fetch happened.
//   3. Method with no `@Permissions` decorator, such as login,
//      never throws regardless of cached permissions.
//   4. Permissions undefined → check skipped entirely. Legacy
//      behavior.
//   5. `setPermissions()` updates the cache mid-session.

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, test, vi } from 'vitest';
import {
  OpenBoxClient,
  MissingPermissionError,
  METHOD_PERMISSIONS,
} from '../../ts/src/client/index.js';
import { BACKEND_ENDPOINT_MANIFEST } from '../../ts/src/client/generated/endpoint-manifest.js';
import {
  OpenBoxClientWrapperBase,
  PATH_PERMISSION_RULES,
} from '../../ts/src/client/generated/wrapper-methods.js';

interface BackendEndpointEntry {
  operationId: string;
  path: string;
  verb: string;
}

const METHOD_NAMES = JSON.parse(
  readFileSync(resolve(process.cwd(), 'codegen/method-names.json'), 'utf8'),
) as Record<string, string>;

const METHOD_PERMISSIONS_BY_OPERATION = JSON.parse(
  readFileSync(resolve(process.cwd(), 'codegen/method-permissions.json'), 'utf8'),
) as Record<string, string[]>;

function noFetch() {
  return vi.fn(async () => {
    throw new Error('fetch should not be called; pre-flight failed to short-circuit');
  });
}

function methodNameForOperation(operationId: string): string {
  const mapped = METHOD_NAMES[operationId];
  if (mapped) return mapped;
  const match = operationId.match(/^([A-Z][a-zA-Z]*Controller)_(.+)$/);
  return match ? match[2] : operationId;
}

function regexForPath(path: string): string {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\\\{[^/]+\\\}/g, '[^/]+')}$`).source;
}

function normalizeRegexSource(source: string): string {
  return source.replace(/\\\//g, '/');
}

function expectedMethodPermissions(): Record<string, string[]> {
  const byOperation = new Map(
    (BACKEND_ENDPOINT_MANIFEST as readonly BackendEndpointEntry[]).map((entry) => [
      entry.operationId,
      entry,
    ]),
  );
  const missingOperations = Object.keys(METHOD_PERMISSIONS_BY_OPERATION).filter(
    (operationId) => !byOperation.has(operationId),
  );
  expect(missingOperations, 'method-permissions.json keys missing from TypeSpec backend endpoints').toEqual([]);

  return Object.fromEntries(
    Object.entries(METHOD_PERMISSIONS_BY_OPERATION)
      .map<[string, string[]]>(([operationId, permissions]) => [
        methodNameForOperation(operationId),
        [...permissions].sort(),
      ])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

function expectedPathPermissionRules(): Array<{
  verb: string;
  pattern: string;
  methodName: string;
  perms: string[];
}> {
  const methodsWithPerms = (BACKEND_ENDPOINT_MANIFEST as readonly BackendEndpointEntry[])
    .map((entry) => ({
      ...entry,
      methodName: methodNameForOperation(entry.operationId),
      perms: METHOD_PERMISSIONS_BY_OPERATION[entry.operationId],
    }))
    .filter((entry): entry is BackendEndpointEntry & { methodName: string; perms: string[] } =>
      Array.isArray(entry.perms) && entry.perms.length > 0,
    );

  return methodsWithPerms
    .sort((a, b) =>
      b.path.replace(/\{[^}]+\}/g, '').length - a.path.replace(/\{[^}]+\}/g, '').length,
    )
    .map((entry) => ({
      verb: entry.verb.toUpperCase(),
      pattern: normalizeRegexSource(regexForPath(entry.path)),
      methodName: entry.methodName,
      perms: [...entry.perms].sort(),
    }));
}

describe('OpenBoxClient permission pre-flight', () => {
  test('TypeSpec-emitted method name map only references backend endpoints', () => {
    const operationIds = new Set(
      (BACKEND_ENDPOINT_MANIFEST as readonly BackendEndpointEntry[]).map(
        (entry) => entry.operationId,
      ),
    );
    const missingOperations = Object.keys(METHOD_NAMES).filter(
      (operationId) => !operationIds.has(operationId),
    );

    expect(
      missingOperations,
      'method-names.json keys missing from TypeSpec backend endpoints',
    ).toEqual([]);
  });

  test('TypeSpec-emitted permission map matches generated TypeScript permission surfaces', () => {
    expect(METHOD_PERMISSIONS).toEqual(expectedMethodPermissions());
    expect(
      PATH_PERMISSION_RULES.map((rule) => ({
        verb: rule.verb,
        pattern: normalizeRegexSource(rule.pattern.source),
        methodName: rule.methodName,
        perms: [...rule.perms],
      })),
    ).toEqual(expectedPathPermissionRules());
  });

  test('METHOD_PERMISSIONS export covers core endpoints', () => {
    // Sanity; the spec→generated→exported chain delivers a non-empty map.
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

  test('method with no required permissions, such as health, is unrestricted', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    // Empty perms; would block listAgents, but health has no @Permissions.
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

    // No `permissions` key at all; wrapper never checks; server is the gate.
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

  test('all required perms must be present (AND, not OR)', () => {
    // Document the current data shape: today every METHOD_PERMISSIONS entry
    // requires exactly one perm, so no data-driven multi-perm method exists
    // to exercise the conjunctive gate.
    const multi = Object.entries(METHOD_PERMISSIONS).filter(
      ([, perms]) => perms.length >= 2,
    );
    expect(multi).toEqual([]);
    for (const [, perms] of Object.entries(METHOD_PERMISSIONS)) {
      expect(perms.length).toBeGreaterThanOrEqual(1);
    }

    // The conjunctive check is load-bearing for when multi-perm methods are
    // added, so verify it directly against the REAL checkPathPermissions by
    // injecting a synthetic 2-perm rule. AND semantics ⇒ holding only one of
    // the two required perms must still throw; OR semantics would pass.
    const syntheticRule = {
      verb: 'POST',
      pattern: /^\/__and_test__$/,
      methodName: 'andTestMethod',
      perms: ['perm:a', 'perm:b'] as const,
    };
    const rules = PATH_PERMISSION_RULES as unknown as Array<typeof syntheticRule>;
    rules.push(syntheticRule);
    try {
      class Probe extends OpenBoxClientWrapperBase {
        protected httpGet<T>(): Promise<T> { throw new Error('no network'); }
        protected httpPost<T>(): Promise<T> { throw new Error('no network'); }
        protected httpPut<T>(): Promise<T> { throw new Error('no network'); }
        protected httpPatch<T>(): Promise<T> { throw new Error('no network'); }
        protected httpDelete<T>(): Promise<T> { throw new Error('no network'); }
        setPerms(perms: string[]): void { this.permissions = new Set(perms); }
        check(verb: string, path: string): void { this.checkPathPermissions(verb, path); }
      }
      const probe = new Probe();

      // Holds only one of the two required perms. AND ⇒ throws; OR ⇒ would pass.
      probe.setPerms(['perm:a']);
      let thrown: unknown;
      try {
        probe.check('POST', '/__and_test__');
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(MissingPermissionError);
      // The conjunctive filter reports exactly the still-missing perm.
      expect((thrown as MissingPermissionError).missing).toEqual(['perm:b']);
      expect((thrown as MissingPermissionError).methodName).toBe('andTestMethod');

      // Holds the other one only — still missing the first.
      probe.setPerms(['perm:b']);
      expect(() => probe.check('POST', '/__and_test__')).toThrow(MissingPermissionError);

      // Holds NEITHER — both reported missing.
      probe.setPerms([]);
      let thrownNone: unknown;
      try {
        probe.check('POST', '/__and_test__');
      } catch (e) {
        thrownNone = e;
      }
      expect((thrownNone as MissingPermissionError).missing).toEqual(['perm:a', 'perm:b']);

      // Holds BOTH — the gate is satisfied and does not throw.
      probe.setPerms(['perm:a', 'perm:b']);
      expect(() => probe.check('POST', '/__and_test__')).not.toThrow();
    } finally {
      rules.pop();
    }
  });
});
