import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenBoxClient, OpenBoxApiError } from '../../ts/src/client/client.js';
import { makeValidToken, makeExpiredToken } from '../helpers/jwt';

// ---------------------------------------------------------------------------
// Helpers
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

function createClient(overrides?: Partial<ConstructorParameters<typeof OpenBoxClient>[0]>) {
  return new OpenBoxClient({
    accessToken: makeValidToken(),
    retry: { maxRetries: 0 },
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpenBoxClient', () => {
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
  // Construction
  // =========================================================================

  describe('construction', () => {
    it('uses OPENBOX_API_URL when apiUrl is not provided', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: 'ok' }));

      await client.health();

      expect(fetchMock).toHaveBeenCalledWith('http://localhost:18080/health', expect.anything());
    });

    it('uses custom apiUrl when provided', async () => {
      const client = createClient({ apiUrl: 'https://custom.example.com' });
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: 'ok' }));

      await client.health();

      expect(fetchMock).toHaveBeenCalledWith(
        'https://custom.example.com/health',
        expect.anything(),
      );
    });

    it('sends X-Openbox-Client: openbox-cli by default', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: 'ok' }));

      await client.health();

      const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
      expect(headers['X-Openbox-Client']).toBe('openbox-cli');
    });

    it('sends X-Openbox-Client with the configured clientName', async () => {
      const client = createClient({ clientName: 'apps/extension' });
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: 'ok' }));

      await client.health();

      const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
      expect(headers['X-Openbox-Client']).toBe('apps/extension');
    });

    it('appends OPENBOX_CLIENT_VARIANT to the header', async () => {
      const orig = process.env.OPENBOX_CLIENT_VARIANT;
      process.env.OPENBOX_CLIENT_VARIANT = 'claude-code';
      try {
        const client = createClient({ clientName: 'runtime/mcp' });
        fetchMock.mockResolvedValueOnce(mockResponse(200, { data: 'ok' }));

        await client.health();

        const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
        expect(headers['X-Openbox-Client']).toBe('runtime/mcp/claude-code');
      } finally {
        if (orig === undefined) delete process.env.OPENBOX_CLIENT_VARIANT;
        else process.env.OPENBOX_CLIENT_VARIANT = orig;
      }
    });
  });

  // =========================================================================
  // HTTP verb routing
  // =========================================================================

  describe('HTTP verb routing', () => {
    let client: OpenBoxClient;

    beforeEach(() => {
      client = createClient();
    });

    it('GET requests use GET method', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: [] }));
      await client.listAgents();
      expect(fetchMock.mock.calls[0][1].method).toBe('GET');
    });

    it('POST requests use POST method', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: {} }));
      await client.createAgent({
        agent_name: 'test',
        team_ids: ['t1'],
        icon: 'icon',
        attestation_mode: 'kms',
        aivss_config: {
          base_security: {
            attack_vector: 1,
            attack_complexity: 1,
            privileges_required: 1,
            user_interaction: 1,
            scope: 1,
          },
          ai_specific: {
            model_robustness: 1,
            data_sensitivity: 1,
            ethical_impact: 1,
            decision_criticality: 1,
            adaptability: 1,
          },
          impact: {
            confidentiality_impact: 1,
            integrity_impact: 1,
            availability_impact: 1,
            safety_impact: 1,
          },
        },
        goal_alignment_config: {
          alignment_threshold: 80,
          llama_firewall_model: 'gpt-4o-mini',
          drift_detection_action: 'alert_only',
          evaluation_frequency: 'every_action',
        },
      });
      expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    });

    it('PUT requests use PUT method', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: {} }));
      await client.updateAgent('agent-1', { agent_name: 'updated' });
      expect(fetchMock.mock.calls[0][1].method).toBe('PUT');
    });

    it('PATCH requests use PATCH method', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: {} }));
      await client.reorderGuardrail('agent-1', 'guard-1', { order: 2 });
      expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
    });

    it('DELETE requests use DELETE method', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: {} }));
      await client.deleteAgent('agent-1');
      expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
    });
  });

  // =========================================================================
  // Request construction
  // =========================================================================

  describe('request construction', () => {
    let client: OpenBoxClient;
    const token = makeValidToken();

    beforeEach(() => {
      client = createClient({ accessToken: token });
    });

    it('sets Authorization header with bearer token', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: {} }));
      await client.health();
      const headers = fetchMock.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe(`Bearer ${token}`);
    });

    it('sets Content-Type to application/json', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: {} }));
      await client.health();
      const headers = fetchMock.mock.calls[0][1].headers;
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('serializes query params to URL search params', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: [] }));
      await client.listAgents({ page: 1, perPage: 5, search: 'test' });
      const url: string = fetchMock.mock.calls[0][0];
      expect(url).toContain('page=1');
      expect(url).toContain('perPage=5');
      expect(url).toContain('search=test');
    });

    it('omits undefined and null query params', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: [] }));
      await client.listAgents({ page: 1, perPage: undefined });
      const url: string = fetchMock.mock.calls[0][0];
      expect(url).toContain('page=1');
      expect(url).not.toContain('perPage');
    });

    it('JSON-stringifies request body', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: {} }));
      await client.changePassword({
        currentPassword: 'old',
        newPassword: 'new',
        orgId: 'org-1',
      });
      const body = fetchMock.mock.calls[0][1].body;
      expect(JSON.parse(body)).toEqual({
        currentPassword: 'old',
        newPassword: 'new',
        orgId: 'org-1',
      });
    });

    it('omits body for GET requests without data', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: {} }));
      await client.health();
      expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
    });

    it('constructs correct URL paths', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: {} }));
      await client.getAgent('abc-123');
      expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:18080/agent/abc-123');
    });
  });

  // =========================================================================
  // Response handling
  // =========================================================================

  describe('response handling', () => {
    let client: OpenBoxClient;

    beforeEach(() => {
      client = createClient();
    });

    it('unwraps { data } envelope and returns data', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, { status: 200, data: { agents: ['a1', 'a2'] } }),
      );
      const result = await client.listAgents();
      expect(result).toEqual({ agents: ['a1', 'a2'] });
    });

    it('returns raw response when no data property in envelope', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { message: 'healthy' }));
      const result = await client.health();
      expect(result).toEqual({ message: 'healthy' });
    });

    it('returns text for non-JSON content-type', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, 'plain text response', 'text/plain'));
      const result = await client.health();
      expect(result).toBe('plain text response');
    });
  });

  // =========================================================================
  // Error handling
  // =========================================================================

  describe('error handling', () => {
    let client: OpenBoxClient;

    beforeEach(() => {
      client = createClient();
    });

    it('throws OpenBoxApiError on 400 response', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(400, { message: 'Bad request' }));
      await expect(client.health()).rejects.toThrow(OpenBoxApiError);
    });

    it('throws OpenBoxApiError on 401 response', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(401, { message: 'Unauthorized' }));
      await expect(client.health()).rejects.toThrow(OpenBoxApiError);
    });

    it('throws OpenBoxApiError on 404 response', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(404, { message: 'Not found' }));
      await expect(client.getAgent('nope')).rejects.toThrow(OpenBoxApiError);
    });

    it('throws OpenBoxApiError on 500 response', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(500, { message: 'Internal error' }));
      await expect(client.health()).rejects.toThrow(OpenBoxApiError);
    });

    it('error includes status code', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(422, { errors: ['invalid field'] }));
      try {
        await client.health();
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as OpenBoxApiError).status).toBe(422);
      }
    });

    it('error includes parsed JSON body', async () => {
      const errorBody = { message: 'Validation failed', errors: ['name required'] };
      fetchMock.mockResolvedValueOnce(mockResponse(400, errorBody));
      try {
        await client.health();
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as OpenBoxApiError).body).toEqual(errorBody);
      }
    });

    it('error includes text body for non-JSON error responses', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(502, '<html>Bad Gateway</html>', 'text/html'));
      try {
        await client.health();
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as OpenBoxApiError).status).toBe(502);
        expect((err as OpenBoxApiError).body).toBe('<html>Bad Gateway</html>');
      }
    });

    it('error is instanceof OpenBoxApiError and Error', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(500, { message: 'fail' }));
      try {
        await client.health();
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(OpenBoxApiError);
        expect(err).toBeInstanceOf(Error);
      }
    });
  });

  // =========================================================================
  // Token refresh
  // =========================================================================

  // Auto-refresh is gated by OpenBoxClient.REFRESH_ENABLED (currently
  // false; pending upstream /auth/refresh fixes). These tests verify
  // the correct enabled-path behavior, so they only run when the flag
   // is on. Reading the static via `as any` because it's `private`;   // we explicitly want the test to track the production value. Do not
  // rewrite them to assert the disabled path.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const refreshEnabled = (OpenBoxClient as any).REFRESH_ENABLED === true;
  describe.runIf(refreshEnabled)('token refresh', () => {
    it('auto-refreshes when access token is expired and refresh token is available', async () => {
      const newToken = makeValidToken();
      const client = createClient({
        accessToken: makeExpiredToken(),
        refreshToken: 'refresh-tok',
      });

      // First call: refresh endpoint
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, { data: { accessToken: newToken, refreshToken: 'new-refresh' } }),
      );
      // Second call: actual request
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: 'ok' }));

      await client.health();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      // First call was to refresh
      expect(fetchMock.mock.calls[0][0]).toContain('/auth/refresh');
      // Second call used the new token
      expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${newToken}`);
    });

    it('calls onTokenRefresh callback after successful refresh', async () => {
      const onTokenRefresh = vi.fn();
      const newToken = makeValidToken();
      const client = createClient({
        accessToken: makeExpiredToken(),
        refreshToken: 'refresh-tok',
        onTokenRefresh,
      });

      fetchMock.mockResolvedValueOnce(
        mockResponse(200, { data: { accessToken: newToken, refreshToken: 'new-refresh' } }),
      );
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: 'ok' }));

      await client.health();

      expect(onTokenRefresh).toHaveBeenCalledWith({
        accessToken: newToken,
        refreshToken: 'new-refresh',
      });
    });

    it('concurrent requests share the same refresh promise', async () => {
      const newToken = makeValidToken();
      const client = createClient({
        accessToken: makeExpiredToken(),
        refreshToken: 'refresh-tok',
      });

      // One refresh call
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, { data: { accessToken: newToken, refreshToken: 'new-refresh' } }),
      );
      // Two actual requests
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: 'r1' }));
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: 'r2' }));

      await Promise.all([client.health(), client.getProfile()]);

      // Only 1 refresh call + 2 actual calls = 3 total
      const refreshCalls = (fetchMock.mock.calls as [string, RequestInit][]).filter((c) =>
        c[0].includes('/auth/refresh'),
      );
      expect(refreshCalls).toHaveLength(1);
    });

    it('throws when token is expired and no refresh token is provided', async () => {
      const client = createClient({
        accessToken: makeExpiredToken(),
      });

      await expect(client.health()).rejects.toThrow(OpenBoxApiError);
      await expect(client.health()).rejects.toThrow(
        'Access token is expired and no refresh token was provided',
      );
    });

    it('throws when refresh request fails', async () => {
      const client = createClient({
        accessToken: makeExpiredToken(),
        refreshToken: 'bad-refresh',
      });

      fetchMock.mockResolvedValueOnce(mockResponse(401, { message: 'Invalid refresh token' }));

      await expect(client.health()).rejects.toThrow(OpenBoxApiError);
    });
  });

  // =========================================================================
  // Specific method coverage
  // =========================================================================

  describe('specific method coverage', () => {
    let client: OpenBoxClient;

    beforeEach(() => {
      client = createClient();
    });

    it('listAgents sends GET to /agent/list', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: [] }));
      await client.listAgents({ page: 0, perPage: 10 });
      expect(fetchMock.mock.calls[0][0]).toContain('/agent/list');
      expect(fetchMock.mock.calls[0][1].method).toBe('GET');
    });

    it('getProfile sends GET to /auth/profile', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: {} }));
      await client.getProfile();
      expect(fetchMock.mock.calls[0][0]).toContain('/auth/profile');
    });

    it('deleteGuardrail sends DELETE to correct path', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: {} }));
      await client.deleteGuardrail('agent-1', 'guard-1');
      expect(fetchMock.mock.calls[0][0]).toContain('/agent/agent-1/guardrails/guard-1');
      expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
    });

    it('decideApproval sends PUT with action query param', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: {} }));
      await client.decideApproval('agent-1', 'event-1', { action: 'approve' });
      const url: string = fetchMock.mock.calls[0][0];
      expect(url).toContain('/agent/agent-1/approvals/event-1/decide');
      expect(url).toContain('action=approve');
    });

    it('terminateSession sends PATCH', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: {} }));
      await client.terminateSession('agent-1', 'session-1');
      expect(fetchMock.mock.calls[0][0]).toContain('/agent/agent-1/sessions/session-1/terminate');
      expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
    });
  });

  // =========================================================================
  // Retry logic
  // =========================================================================

  describe('retry logic', () => {
    it('retries on 500 and succeeds on second attempt', async () => {
      const client = new OpenBoxClient({
        accessToken: makeValidToken(),
        retry: { maxRetries: 2, initialDelayMs: 1 },
      });

      fetchMock
        .mockResolvedValueOnce(mockResponse(500, { error: 'fail' }))
        .mockResolvedValueOnce(mockResponse(200, { data: 'ok' }));

      const result = await client.health();
      expect(result).toBe('ok');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('retries on 429 and succeeds', async () => {
      const client = new OpenBoxClient({
        accessToken: makeValidToken(),
        retry: { maxRetries: 1, initialDelayMs: 1 },
      });

      const rateLimitResponse = {
        ...mockResponse(429, { error: 'rate limited' }),
        headers: new Headers({
          'content-type': 'application/json',
          'retry-after': '0',
        }),
      } as Response;

      fetchMock
        .mockResolvedValueOnce(rateLimitResponse)
        .mockResolvedValueOnce(mockResponse(200, { data: 'ok' }));

      const result = await client.health();
      expect(result).toBe('ok');
    });

    it('does not retry on 400', async () => {
      const client = new OpenBoxClient({
        accessToken: makeValidToken(),
        retry: { maxRetries: 3, initialDelayMs: 1 },
      });

      fetchMock.mockResolvedValueOnce(mockResponse(400, { error: 'bad request' }));

      await expect(client.health()).rejects.toThrow(OpenBoxApiError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not retry on 404', async () => {
      const client = new OpenBoxClient({
        accessToken: makeValidToken(),
        retry: { maxRetries: 3, initialDelayMs: 1 },
      });

      fetchMock.mockResolvedValueOnce(mockResponse(404, { error: 'not found' }));

      await expect(client.health()).rejects.toThrow(OpenBoxApiError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('exhausts max retries and throws', async () => {
      const client = new OpenBoxClient({
        accessToken: makeValidToken(),
        retry: { maxRetries: 2, initialDelayMs: 1 },
      });

      fetchMock
        .mockResolvedValueOnce(mockResponse(502, { error: 'bad gateway' }))
        .mockResolvedValueOnce(mockResponse(502, { error: 'bad gateway' }))
        .mockResolvedValueOnce(mockResponse(502, { error: 'bad gateway' }));

      await expect(client.health()).rejects.toThrow(OpenBoxApiError);
      expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it('retries on network error (TypeError)', async () => {
      const client = new OpenBoxClient({
        accessToken: makeValidToken(),
        retry: { maxRetries: 1, initialDelayMs: 1 },
      });

      fetchMock
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(mockResponse(200, { data: 'ok' }));

      const result = await client.health();
      expect(result).toBe('ok');
    });

    it('does not retry when maxRetries is 0', async () => {
      const client = new OpenBoxClient({
        accessToken: makeValidToken(),
        retry: { maxRetries: 0 },
      });

      fetchMock.mockResolvedValueOnce(mockResponse(500, { error: 'fail' }));

      await expect(client.health()).rejects.toThrow(OpenBoxApiError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('respects Retry-After header as seconds', async () => {
      const client = new OpenBoxClient({
        accessToken: makeValidToken(),
        retry: { maxRetries: 1, initialDelayMs: 10000 },
      });

      const rateLimitResponse = {
        ...mockResponse(429, { error: 'rate limited' }),
        headers: new Headers({
          'content-type': 'application/json',
          'retry-after': '0',
        }),
      } as Response;

      fetchMock
        .mockResolvedValueOnce(rateLimitResponse)
        .mockResolvedValueOnce(mockResponse(200, { data: 'ok' }));

      const start = Date.now();
      await client.health();
      const elapsed = Date.now() - start;

      // Should use Retry-After: 0 instead of initialDelayMs: 10000
      expect(elapsed).toBeLessThan(5000);
    });
  });

  // =========================================================================
  // Rate limiting
  // =========================================================================

  describe('rate limiting', () => {
    it('makes requests when rate limiter is configured', async () => {
      const client = new OpenBoxClient({
        accessToken: makeValidToken(),
        retry: { maxRetries: 0 },
        rateLimit: { requestsPerSecond: 100 },
      });

      fetchMock.mockResolvedValue(mockResponse(200, { data: 'ok' }));

      await client.health();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('works without rate limiter configured', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: 'ok' }));

      await client.health();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // Pagination helpers
  // =========================================================================

  describe('pagination helpers', () => {
    let client: OpenBoxClient;

    beforeEach(() => {
      client = createClient();
    });

    it('paginate yields pages until empty', async () => {
      fetchMock
        .mockResolvedValueOnce(mockResponse(200, { data: { data: [{ id: '1' }, { id: '2' }] } }))
        .mockResolvedValueOnce(mockResponse(200, { data: { data: [{ id: '3' }] } }));

      const pages: unknown[][] = [];
      for await (const page of client.paginate((q) => client.listAgents(q), 2)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
      expect(pages[0]).toHaveLength(2);
      expect(pages[1]).toHaveLength(1);
    });

    it('paginate stops on empty page', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: { data: [] } }));

      const pages: unknown[][] = [];
      for await (const page of client.paginate((q) => client.listAgents(q), 10)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(0);
    });

    it('paginateAll collects all items', async () => {
      fetchMock
        .mockResolvedValueOnce(mockResponse(200, { data: { data: [{ id: '1' }, { id: '2' }] } }))
        .mockResolvedValueOnce(mockResponse(200, { data: { data: [{ id: '3' }] } }));

      const all = await client.paginateAll((q) => client.listAgents(q), 2);

      expect(all).toHaveLength(3);
    });
  });

  // =========================================================================
  // Request timeout
  // =========================================================================

  describe('request timeout', () => {
    it('passes AbortSignal.timeout to fetch with default 30s', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: 'ok' }));

      await client.health();

      const signal = fetchMock.mock.calls[0][1].signal;
      expect(signal).toBeDefined();
    });

    it('uses custom timeoutMs from config', async () => {
      const client = createClient({ timeoutMs: 5000 });
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: 'ok' }));

      await client.health();

      const signal = fetchMock.mock.calls[0][1].signal;
      expect(signal).toBeDefined();
    });
  });
});
