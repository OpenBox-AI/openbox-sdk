import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenBoxCoreClient, CoreApiError } from '../../ts/src/core-client/core-client.js';

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

describe('OpenBoxCoreClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function createClient(overrides?: Partial<ConstructorParameters<typeof OpenBoxCoreClient>[0]>) {
    return new OpenBoxCoreClient({
      apiKey: 'obx_live_test123',
      retry: { maxRetries: 0 },
      ...overrides,
    });
  }

  describe('construction', () => {
    it('uses default core URL', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(mockResponse(200, 'hello world', 'text/plain'));
      await client.health();
      expect(fetchMock.mock.calls[0][0]).toBe('https://core.openbox.ai/');
    });

    it('uses custom URL', async () => {
      const client = createClient({ apiUrl: 'https://custom.core.com' });
      fetchMock.mockResolvedValueOnce(mockResponse(200, 'hello', 'text/plain'));
      await client.health();
      expect(fetchMock.mock.calls[0][0]).toBe('https://custom.core.com/');
    });
  });

  describe('health', () => {
    it('returns text response', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(mockResponse(200, 'hello world', 'text/plain'));
      const result = await client.health();
      expect(result).toBe('hello world');
    });
  });

  describe('validateApiKey', () => {
    it('sends GET to /api/v1/auth/validate', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(mockResponse(200, { valid: true }));
      await client.validateApiKey();
      expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/auth/validate');
      expect(fetchMock.mock.calls[0][1].method).toBe('GET');
    });

    it('sets Authorization header with API key', async () => {
      const client = createClient({ apiKey: 'obx_live_mykey' });
      fetchMock.mockResolvedValueOnce(mockResponse(200, {}));
      await client.validateApiKey();
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer obx_live_mykey');
    });
  });

  describe('evaluate', () => {
    it('sends POST to governance/evaluate with payload', async () => {
      const client = createClient();
      const verdict = { verdict: 'ALLOW', action: 'allow' };
      fetchMock.mockResolvedValueOnce(mockResponse(200, verdict));

      const result = await client.evaluate({
        event_type: 'ActivityStarted',
        workflow_id: 'wf-1',
        run_id: 'run-1',
        activity_id: 'act-1',
        activity_type: 'my-activity',
      });

      expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/governance/evaluate');
      expect(fetchMock.mock.calls[0][1].method).toBe('POST');
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
        event_type: 'ActivityStarted',
        workflow_id: 'wf-1',
      });
      expect(result.verdict).toBe('ALLOW');
    });
  });

  describe('pollApproval', () => {
    it('sends POST to governance/approval', async () => {
      const client = createClient();
      const response = { verdict: 'ALLOW', action: 'allow', expired: false };
      fetchMock.mockResolvedValueOnce(mockResponse(200, response));

      const result = await client.pollApproval({
        workflow_id: 'wf-1',
        run_id: 'run-1',
        activity_id: 'act-1',
      });

      expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/governance/approval');
      expect(result.verdict).toBe('ALLOW');
    });
  });

  describe('error handling', () => {
    it('throws CoreApiError on 401', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(mockResponse(401, { code: 401, message: 'invalid key' }));
      await expect(client.validateApiKey()).rejects.toThrow(CoreApiError);
    });

    it('error has status and body', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(mockResponse(401, { code: 401, message: 'bad' }));
      try {
        await client.validateApiKey();
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as CoreApiError).status).toBe(401);
        expect((err as CoreApiError).body).toEqual({ code: 401, message: 'bad' });
      }
    });
  });
});
