import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenBoxClient, OpenBoxApiError } from '../../ts/src/client/client.js';
import { makeValidToken, makeExpiredToken } from '../helpers/jwt';

// ---------------------------------------------------------------------------
// Targeted coverage for ts/src/client/client.ts. Drives the HTTP retry/error
// paths, static getVersion(), the retryable-status / Retry-After logic, the
// token-refresh edge cases, and the reactive-refresh request branch that the
// main client.test.ts leaves uncovered (REFRESH_ENABLED is shipped false).
// ---------------------------------------------------------------------------

function mockResponse(status: number, body: unknown, contentType = 'application/json'): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': contentType }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response;
}

function rateLimited(retryAfter: string, body: unknown = { error: 'rate limited' }): Response {
  return {
    ...mockResponse(429, body),
    headers: new Headers({
      'content-type': 'application/json',
      'retry-after': retryAfter,
    }),
  } as Response;
}

describe('client.ts targeted coverage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // =========================================================================
  // static getVersion()  (lines 119, 121, 128, 144, 147 + payload branches)
  // =========================================================================

  describe('getVersion', () => {
    it('returns null for an empty baseUrl without touching fetch', async () => {
      const result = await OpenBoxClient.getVersion('');
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('normalizes a flat payload with builtAt (camelCase)', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, { commit: 'abc123', version: '1.2.3', builtAt: '2026-01-01T00:00:00Z' }),
      );
      const result = await OpenBoxClient.getVersion('http://svc.local', { timeoutMs: 1000 });
      expect(result).toEqual({
        commit: 'abc123',
        version: '1.2.3',
        builtAt: '2026-01-01T00:00:00Z',
      });
      expect(fetchMock.mock.calls[0][0]).toBe('http://svc.local/version');
    });

    it('unwraps a { data } envelope and accepts snake_case built_at', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, { data: { commit: 'deadbeef', built_at: '2026-02-02T00:00:00Z' } }),
      );
      const result = await OpenBoxClient.getVersion('http://svc.local');
      expect(result).toEqual({
        commit: 'deadbeef',
        version: undefined,
        builtAt: '2026-02-02T00:00:00Z',
      });
    });

    it('returns null when the response is not ok', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(503, { message: 'down' }));
      expect(await OpenBoxClient.getVersion('http://svc.local')).toBeNull();
    });

    it('returns null when the payload has no version fields', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, {}));
      expect(await OpenBoxClient.getVersion('http://svc.local')).toBeNull();
    });

    it('returns null when fetch throws (timeout / network)', async () => {
      fetchMock.mockRejectedValueOnce(new Error('aborted'));
      expect(await OpenBoxClient.getVersion('http://svc.local')).toBeNull();
    });

    it('arms the abort timer whose callback fires on a slow version probe', async () => {
      fetchMock.mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(mockResponse(200, { version: '9.9.9' })), 25),
          ),
      );
      const result = await OpenBoxClient.getVersion('http://svc.local', { timeoutMs: 1 });
      expect(result).toEqual({ commit: undefined, version: '9.9.9', builtAt: undefined });
    });
  });

  // =========================================================================
  // Constructor permissions, requestOperation, setPermissions
  // (lines 168-169, 185/193, 202-203)
  // =========================================================================

  describe('permissions and dynamic operation', () => {
    it('seeds the permission cache from config and routes requestOperation', async () => {
      const client = new OpenBoxClient({
        accessToken: makeValidToken(),
        retry: { maxRetries: 0 },
        permissions: ['read:agent'],
      });
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: 'ok' }));
      const result = await client.requestOperation('GET', '/health');
      expect(result).toBe('ok');
      expect(fetchMock.mock.calls[0][1].method).toBe('GET');
    });

    it('setPermissions sets and clears the cached permission set', () => {
      const client = new OpenBoxClient({ accessToken: makeValidToken() });
      expect(() => client.setPermissions(['read:agent'])).not.toThrow();
      expect(() => client.setPermissions(undefined)).not.toThrow();
    });
  });

  // =========================================================================
  // Array query-param serialization (lines 521, 527-528 incl. nullish skip)
  // =========================================================================

  it('repeats array query params and skips undefined/null elements', async () => {
    const client = new OpenBoxClient({ accessToken: makeValidToken(), retry: { maxRetries: 0 } });
    fetchMock.mockResolvedValueOnce(mockResponse(200, { data: 'ok' }));
    await client.requestOperation('GET', '/health', {
      params: { tiers: [2, 3, undefined, null], scalar: 'x' },
    });
    const url: string = fetchMock.mock.calls[0][0];
    expect(url).toContain('tiers=2');
    expect(url).toContain('tiers=3');
    expect(url).toContain('scalar=x');
    // Two array entries only (undefined/null dropped).
    expect((url.match(/tiers=/g) ?? []).length).toBe(2);
  });

  it('omits the query string when all params are nullish (line 535 else)', async () => {
    const client = new OpenBoxClient({ accessToken: makeValidToken(), retry: { maxRetries: 0 } });
    fetchMock.mockResolvedValueOnce(mockResponse(200, { data: 'ok' }));
    await client.requestOperation('GET', '/health', { params: { a: undefined, b: null } });
    // No '?' appended because the serialized query string is empty.
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:18080/health');
  });

  // =========================================================================
  // paginate empty-data fallback (line 258 `result.data ?? []`)
  // =========================================================================

  it('paginate stops when a page has no data field', async () => {
    const client = new OpenBoxClient({ accessToken: makeValidToken() });
    const pages: unknown[][] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const p of client.paginate(async () => ({}) as any)) {
      pages.push(p);
    }
    expect(pages).toHaveLength(0);
  });

  // =========================================================================
  // executeWithRetry: non-TypeError errors rethrow immediately (lines 444-445)
  // =========================================================================

  it('rethrows non-TypeError fetch errors without retrying', async () => {
    const client = new OpenBoxClient({
      accessToken: makeValidToken(),
      retry: { maxRetries: 3, initialDelayMs: 1 },
    });
    fetchMock.mockRejectedValueOnce(new RangeError('not a network error'));
    await expect(client.health()).rejects.toThrow('not a network error');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // =========================================================================
  // Retry-After parsing  (getRetryDelay lines 461-474)
  // =========================================================================

  describe('Retry-After header parsing', () => {
    it('honors an HTTP-date Retry-After value on a 429', async () => {
      const client = new OpenBoxClient({
        accessToken: makeValidToken(),
        retry: { maxRetries: 1, initialDelayMs: 10_000, maxDelayMs: 30_000 },
      });
      // A past date clamps to 0 delay via Math.max(date - now, 0).
      const pastDate = new Date(Date.now() - 100_000).toUTCString();
      fetchMock
        .mockResolvedValueOnce(rateLimited(pastDate))
        .mockResolvedValueOnce(mockResponse(200, { data: 'ok' }));

      const start = Date.now();
      const result = await client.health();
      expect(result).toBe('ok');
      // Used the (past) date delay, not the 10s initialDelayMs.
      expect(Date.now() - start).toBeLessThan(5_000);
    });

    it('backs off when a 429 carries no Retry-After header (line 463 else)', async () => {
      const client = new OpenBoxClient({
        accessToken: makeValidToken(),
        retry: { maxRetries: 1, initialDelayMs: 1, maxDelayMs: 5 },
      });
      // Plain 429: default headers have no retry-after.
      fetchMock
        .mockResolvedValueOnce(mockResponse(429, { error: 'rate limited' }))
        .mockResolvedValueOnce(mockResponse(200, { data: 'ok' }));
      expect(await client.health()).toBe('ok');
    });

    it('falls back to exponential backoff when Retry-After is unparseable', async () => {
      const client = new OpenBoxClient({
        accessToken: makeValidToken(),
        retry: { maxRetries: 1, initialDelayMs: 1, maxDelayMs: 5 },
      });
      fetchMock
        .mockResolvedValueOnce(rateLimited('definitely-not-a-date'))
        .mockResolvedValueOnce(mockResponse(200, { data: 'ok' }));

      expect(await client.health()).toBe('ok');
    });
  });

  // =========================================================================
  // executeWithRetry loop-exit guard  (line 452)
  // =========================================================================

  it('throws the retry-loop guard error when the loop never iterates', async () => {
    const client = new OpenBoxClient({
      accessToken: makeValidToken(),
      // maxRetries < 0 means `attempt <= maxRetries` is false on entry, so
      // the for-loop body never runs and control reaches the guard throw.
      retry: { maxRetries: -1 },
    });
    await expect(client.health()).rejects.toThrow('Retry loop exited unexpectedly');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Request timeout abort callback  (line 546 inner arrow)
  // =========================================================================

  it('arms the abort timer whose callback fires on a slow request', async () => {
    const client = new OpenBoxClient({ accessToken: makeValidToken(), timeoutMs: 1 });
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve(mockResponse(200, { data: 'ok' })), 25),
        ),
    );
    // The 1ms timer fires controller.abort() before the mock resolves; the
    // mock ignores the signal so the request still completes.
    expect(await client.health()).toBe('ok');
  });

  // =========================================================================
  // requireApiUrl  (line 686)
  // =========================================================================

  it('throws when no apiUrl and no OPENBOX_API_URL env is available', () => {
    const saved = process.env.OPENBOX_API_URL;
    delete process.env.OPENBOX_API_URL;
    try {
      expect(() => new OpenBoxClient({ accessToken: makeValidToken() })).toThrow(
        'OPENBOX_API_URL is required',
      );
    } finally {
      if (saved !== undefined) process.env.OPENBOX_API_URL = saved;
    }
  });

  // =========================================================================
  // Token refresh + reactive-refresh branches (require REFRESH_ENABLED=true)
  // Lines 330, 334, 373-378, 596-606.
  // =========================================================================

  describe('refresh-enabled paths', () => {
    let savedFlag: unknown;

    beforeEach(() => {
      savedFlag = (OpenBoxClient as unknown as { REFRESH_ENABLED: unknown }).REFRESH_ENABLED;
      (OpenBoxClient as unknown as { REFRESH_ENABLED: boolean }).REFRESH_ENABLED = true;
    });

    afterEach(() => {
      (OpenBoxClient as unknown as { REFRESH_ENABLED: unknown }).REFRESH_ENABLED = savedFlag;
    });

    it('skips the expiry gate for API-key auth with no access token (line 330)', async () => {
      const client = new OpenBoxClient({ apiKey: 'key-123', retry: { maxRetries: 0 } });
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: 'ok' }));
      expect(await client.health()).toBe('ok');
      const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
      expect(headers['X-API-Key']).toBe('key-123');
    });

    it('throws on a non-ok refresh response (lines 373-378)', async () => {
      const client = new OpenBoxClient({
        accessToken: makeExpiredToken(),
        refreshToken: 'refresh-tok',
        retry: { maxRetries: 0 },
      });
      fetchMock.mockResolvedValueOnce(mockResponse(401, { message: 'invalid refresh' }));

      await expect(client.health()).rejects.toMatchObject({
        name: 'OpenBoxApiError',
        status: 401,
      });
      // Only the refresh call happened; the real request never fired.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:18080/auth/refresh');
    });

    it('parses a flat refresh response and tolerates json() failure on error (lines 373, 384)', async () => {
      // Non-ok refresh whose json() rejects -> body coerced to null (line 373).
      const jsonFails = new OpenBoxClient({
        accessToken: makeExpiredToken(),
        refreshToken: 'refresh-tok',
        retry: { maxRetries: 0 },
      });
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Error',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.reject(new Error('bad json')),
        text: () => Promise.resolve(''),
      } as Response);
      await expect(jsonFails.health()).rejects.toMatchObject({
        name: 'OpenBoxApiError',
        status: 500,
        body: null,
      });

      // Successful flat (un-enveloped) refresh -> `body?.data ?? body` falls to body.
      const newToken = makeValidToken();
      const flat = new OpenBoxClient({
        accessToken: makeExpiredToken(),
        refreshToken: 'refresh-tok',
        retry: { maxRetries: 0 },
      });
      fetchMock
        .mockResolvedValueOnce(mockResponse(200, { accessToken: newToken }))
        .mockResolvedValueOnce(mockResponse(200, { data: 'ok' }));
      expect(await flat.health()).toBe('ok');
      expect(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1].headers.Authorization).toBe(
        `Bearer ${newToken}`,
      );
    });

    it('throws when refresh returns a null body / no access token (line 384 `?? {}`)', async () => {
      const client = new OpenBoxClient({
        accessToken: makeExpiredToken(),
        refreshToken: 'refresh-tok',
        retry: { maxRetries: 0 },
      });
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(null),
        text: () => Promise.resolve('null'),
      } as Response);
      await expect(client.health()).rejects.toMatchObject({
        name: 'OpenBoxApiError',
        status: 500,
      });
    });

    it('wraps a non-Error thrown during refresh (line 409 else branch)', async () => {
      const client = new OpenBoxClient({
        accessToken: makeExpiredToken(),
        refreshToken: 'refresh-tok',
        retry: { maxRetries: 0 },
      });
      // Reject with a non-Error value -> `err instanceof Error` is false.
      fetchMock.mockRejectedValueOnce('socket-string-error');
      await expect(client.health()).rejects.toMatchObject({
        name: 'OpenBoxApiError',
        status: 401,
      });
    });

    it('reactively refreshes and retries after a 401 (lines 334, 596-603)', async () => {
      const newToken = makeValidToken();
      const client = new OpenBoxClient({
        // Valid (non-expired) token: ensureValidToken returns at the
        // isTokenExpired gate (line 334); the 401 drives the reactive path.
        accessToken: makeValidToken(),
        refreshToken: 'refresh-tok',
        retry: { maxRetries: 0 },
      });
      fetchMock
        .mockResolvedValueOnce(mockResponse(401, { message: 'expired' }))
        .mockResolvedValueOnce(mockResponse(200, { data: { accessToken: newToken } }))
        .mockResolvedValueOnce(mockResponse(200, { data: 'ok' }));

      expect(await client.health()).toBe('ok');
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[1][0]).toBe('http://localhost:18080/auth/refresh');
      // Retry carried the refreshed bearer token.
      expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe(`Bearer ${newToken}`);
    });

    it('falls through to the original 401 when reactive refresh fails (lines 604-606)', async () => {
      const client = new OpenBoxClient({
        accessToken: makeValidToken(),
        refreshToken: 'refresh-tok',
        retry: { maxRetries: 0 },
      });
      fetchMock
        .mockResolvedValueOnce(mockResponse(401, { message: 'expired' }))
        // Refresh itself fails -> performTokenRefresh throws -> caught and swallowed.
        .mockResolvedValueOnce(mockResponse(500, { message: 'refresh down' }));

      await expect(client.health()).rejects.toMatchObject({
        name: 'OpenBoxApiError',
        status: 401,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
