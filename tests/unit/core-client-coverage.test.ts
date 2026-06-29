import {
  generateKeyPairSync,
  randomUUID,
} from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  OpenBoxCoreClient,
  CoreApiError,
  signAgentIdentityRequest,
  validateAgentIdentityConfig,
} from '../../ts/src/core-client/core-client.js';
import type { GovernanceEventPayload } from '../../ts/src/core-client/core-client.js';

const ED25519_PKCS8_PREFIX = Buffer.from(
  '302e020100300506032b657004220420',
  'hex',
);

const VALID_KEY = 'obx_live_46313a2294e18b0453fa61ab7268096bca73618df7f7c55b';

function makeRawSeed(): string {
  const { privateKey } = generateKeyPairSync('ed25519');
  const der = privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer;
  return der.subarray(ED25519_PKCS8_PREFIX.length).toString('base64');
}

function makeAgentIdentity() {
  return {
    did: `did:aip:${randomUUID()}`,
    privateKey: makeRawSeed(),
  };
}

function mockResponse(
  status: number,
  body: unknown,
  contentType: string | null = 'application/json',
): Response {
  const headers = new Headers();
  if (contentType !== null) headers.set('content-type', contentType);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    headers,
    json: () => Promise.resolve(body),
    text: () =>
      Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response;
}

function evaluatePayload(
  extra: Record<string, unknown> = {},
): GovernanceEventPayload {
  return {
    event_type: 'ActivityStarted',
    workflow_id: 'wf-1',
    run_id: 'run-1',
    workflow_type: 'unit-test',
    task_queue: 'langchain',
    source: 'workflow-telemetry',
    timestamp: new Date().toISOString(),
    activity_id: 'act-1',
    activity_type: 'my-activity',
    ...extra,
  } as GovernanceEventPayload;
}

describe('core-client coverage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function createClient(
    overrides?: Partial<ConstructorParameters<typeof OpenBoxCoreClient>[0]>,
  ) {
    return new OpenBoxCoreClient({
      apiKey: VALID_KEY,
      retry: { maxRetries: 0 },
      ...overrides,
    });
  }

  // -------------------------------------------------------------------------
  // construction: rate limiter branch (lines 143-148) + url resolution
  // -------------------------------------------------------------------------
  describe('construction', () => {
    it('builds a TokenBucket when rateLimit is configured (with burst)', async () => {
      const client = createClient({
        rateLimit: { requestsPerSecond: 1000, burst: 10 },
      });
      fetchMock.mockResolvedValueOnce(mockResponse(200, {}));
      await client.validateApiKey();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('builds a TokenBucket when rateLimit is configured (no burst)', async () => {
      const client = createClient({
        rateLimit: { requestsPerSecond: 1000 },
      });
      fetchMock.mockResolvedValueOnce(mockResponse(200, {}));
      await client.validateApiKey();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('acquires a rate-limit token before issuing the request (line 229)', async () => {
      const client = createClient({
        rateLimit: { requestsPerSecond: 1000, burst: 5 },
      });
      fetchMock.mockResolvedValueOnce(mockResponse(200, { ok: true }));
      await client.validateApiKey();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to OPENBOX_CORE_URL env when apiUrl is omitted', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(mockResponse(200, 'ok', 'text/plain'));
      await client.health();
      expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:18081/');
    });

    it('throws when neither apiUrl nor OPENBOX_CORE_URL is set (line 361)', () => {
      const saved = process.env.OPENBOX_CORE_URL;
      delete process.env.OPENBOX_CORE_URL;
      try {
        expect(
          () => new OpenBoxCoreClient({ apiKey: VALID_KEY, apiUrl: undefined }),
        ).toThrow('OPENBOX_CORE_URL is required');
      } finally {
        if (saved !== undefined) process.env.OPENBOX_CORE_URL = saved;
      }
    });
  });

  // -------------------------------------------------------------------------
  // response handling: error wrapping + content-type branches (264-282)
  // -------------------------------------------------------------------------
  describe('response handling', () => {
    it('wraps non-ok JSON responses as CoreApiError with parsed body (268-272)', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(
        mockResponse(500, { code: 500, message: 'boom' }),
      );
      await expect(client.validateApiKey()).rejects.toMatchObject({
        name: 'CoreApiError',
        status: 500,
        body: { code: 500, message: 'boom' },
      });
    });

    it('wraps non-ok non-JSON responses using text body', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(
        mockResponse(503, 'service unavailable', 'text/plain'),
      );
      try {
        await client.validateApiKey();
        expect.fail('should throw');
      } catch (err) {
        expect(err).toBeInstanceOf(CoreApiError);
        expect((err as CoreApiError).body).toBe('service unavailable');
      }
    });

    it('returns text when the success response has no content-type (264, 275-276)', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(mockResponse(200, 'plain', null));
      await expect(client.health()).resolves.toBe('plain');
    });

    it('returns parsed JSON for application/json success responses', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(mockResponse(200, { ok: 1 }));
      await expect(client.validateApiKey()).resolves.toEqual({ ok: 1 });
    });
  });

  // -------------------------------------------------------------------------
  // executeOnce (evaluate, retryable:false) — timer setup/teardown (290-303)
  // -------------------------------------------------------------------------
  describe('executeOnce path (evaluate)', () => {
    it('issues a single fetch with timeout for evaluate', async () => {
      const client = createClient({ timeoutMs: 1234 });
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, { verdict: 'ALLOW', action: 'allow' }),
      );
      const result = await client.evaluate(evaluatePayload());
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.verdict).toBe('ALLOW');
      expect(result.governance_checks_incomplete).toBe(false);
    });

    it('normalizes age_result governance_checks_incomplete defaults', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, {
          verdict: 'ALLOW',
          action: 'allow',
          age_result: { trust_score: { score: 1 } },
        }),
      );
      const result = await client.evaluate(evaluatePayload());
      expect(result.age_result?.governance_checks_incomplete).toBe(false);
    });

    it('propagates evaluate HTTP errors without retrying', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(mockResponse(500, { message: 'down' }));
      await expect(client.evaluate(evaluatePayload())).rejects.toBeInstanceOf(
        CoreApiError,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // executeWithRetry branches (306-351)
  // -------------------------------------------------------------------------
  describe('executeWithRetry path', () => {
    it('returns immediately on a successful response', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(mockResponse(200, {}));
      await client.validateApiKey();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not retry on a non-retryable non-ok status (line 332)', async () => {
      const client = createClient({ retry: { maxRetries: 3 } });
      fetchMock.mockResolvedValueOnce(mockResponse(400, { message: 'bad' }));
      await expect(client.validateApiKey()).rejects.toBeInstanceOf(
        CoreApiError,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('returns the last retryable response when retries are exhausted (line 335)', async () => {
      const client = createClient({ retry: { maxRetries: 0 } });
      fetchMock.mockResolvedValueOnce(mockResponse(503, { message: 'busy' }));
      await expect(client.validateApiKey()).rejects.toMatchObject({
        status: 503,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('retries a retryable status then succeeds (lines 336-337)', async () => {
      const client = createClient({
        retry: { maxRetries: 2, initialDelayMs: 1, maxDelayMs: 4 },
      });
      fetchMock
        .mockResolvedValueOnce(mockResponse(503, { message: 'busy' }))
        .mockResolvedValueOnce(mockResponse(200, { ok: true }));
      await expect(client.validateApiKey()).resolves.toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('retries on a network TypeError then succeeds (catch branch)', async () => {
      const client = createClient({
        retry: { maxRetries: 2, initialDelayMs: 1, maxDelayMs: 4 },
      });
      fetchMock
        .mockRejectedValueOnce(new TypeError('network down'))
        .mockResolvedValueOnce(mockResponse(200, { ok: true }));
      await expect(client.validateApiKey()).resolves.toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('retries on an AbortError timeout then succeeds (catch branch)', async () => {
      const client = createClient({
        retry: { maxRetries: 2, initialDelayMs: 1, maxDelayMs: 4 },
      });
      const abort = new Error('aborted');
      abort.name = 'AbortError';
      fetchMock
        .mockRejectedValueOnce(abort)
        .mockResolvedValueOnce(mockResponse(200, { ok: true }));
      await expect(client.validateApiKey()).resolves.toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('rethrows a non-retryable error immediately (line 343)', async () => {
      const client = createClient({ retry: { maxRetries: 3 } });
      fetchMock.mockRejectedValueOnce(new RangeError('not retryable'));
      await expect(client.validateApiKey()).rejects.toBeInstanceOf(RangeError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rethrows when retries are exhausted on a network error (line 343)', async () => {
      const client = createClient({
        retry: { maxRetries: 1, initialDelayMs: 1, maxDelayMs: 2 },
      });
      fetchMock.mockRejectedValue(new TypeError('network down'));
      await expect(client.validateApiKey()).rejects.toBeInstanceOf(TypeError);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('uses default retry settings when none are configured', async () => {
      const client = new OpenBoxCoreClient({ apiKey: VALID_KEY });
      fetchMock.mockResolvedValueOnce(mockResponse(200, { ok: true }));
      await expect(client.validateApiKey()).resolves.toEqual({ ok: true });
    });
  });

  // -------------------------------------------------------------------------
  // per-attempt timeout firing the abort callbacks (lines 292, 317)
  // -------------------------------------------------------------------------
  describe('request timeout / abort', () => {
    // Fetch that only settles when its AbortController signal aborts,
    // forcing the setTimeout(() => controller.abort()) callback to run.
    function abortableFetch() {
      return (_url: string, opts: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = opts.signal as AbortSignal;
          const fail = () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          };
          if (signal.aborted) {
            fail();
            return;
          }
          signal.addEventListener('abort', fail);
        });
    }

    it('aborts the single-shot evaluate fetch on timeout (line 292)', async () => {
      fetchMock.mockImplementation(abortableFetch());
      const client = createClient({ timeoutMs: 1 });
      await expect(client.evaluate(evaluatePayload())).rejects.toMatchObject({
        name: 'AbortError',
      });
    });

    it('aborts retry-loop fetches on timeout and retries (line 317)', async () => {
      fetchMock.mockImplementation(abortableFetch());
      const client = createClient({
        timeoutMs: 1,
        retry: { maxRetries: 1, initialDelayMs: 1, maxDelayMs: 2 },
      });
      await expect(client.validateApiKey()).rejects.toMatchObject({
        name: 'AbortError',
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // appendQuery via requestOperation (379-394)
  // -------------------------------------------------------------------------
  describe('appendQuery (requestOperation params)', () => {
    it('passes the path through untouched when no params are given', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(mockResponse(200, { ok: true }));
      await client.requestOperation('GET', '/api/v1/auth/validate');
      expect(fetchMock.mock.calls[0][0]).toBe(
        'http://localhost:18081/api/v1/auth/validate',
      );
    });

    it('builds a query string, skipping null/undefined and expanding arrays', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(mockResponse(200, { ok: true }));
      await client.requestOperation('GET', '/api/v1/auth/validate', {
        params: {
          a: 1,
          skipNull: null,
          skipUndef: undefined,
          tags: ['x', null, undefined, 'y'],
        },
      });
      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('a=1');
      expect(url).toContain('tags=x');
      expect(url).toContain('tags=y');
      expect(url).not.toContain('skipNull');
      expect(url).not.toContain('skipUndef');
    });

    it('appends with & when the path already has a query string', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(mockResponse(200, { ok: true }));
      await client.requestOperation('GET', '/api/v1/auth/validate?existing=1', {
        params: { extra: 2 },
      });
      expect(fetchMock.mock.calls[0][0]).toBe(
        'http://localhost:18081/api/v1/auth/validate?existing=1&extra=2',
      );
    });

    it('returns the original path when params resolve to an empty query (line 393)', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(mockResponse(200, { ok: true }));
      await client.requestOperation('GET', '/api/v1/auth/validate', {
        params: { onlyNull: null, onlyUndef: undefined },
      });
      expect(fetchMock.mock.calls[0][0]).toBe(
        'http://localhost:18081/api/v1/auth/validate',
      );
    });
  });

  // -------------------------------------------------------------------------
  // toGovernanceJsonSafe edge values (418-469) via evaluate payload
  // -------------------------------------------------------------------------
  describe('governance payload sanitization', () => {
    async function sendAndReadInput(input: unknown) {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, { verdict: 'ALLOW', action: 'allow' }),
      );
      await client.evaluate(evaluatePayload({ activity_input: [input] }));
      return JSON.parse(fetchMock.mock.calls[0][1].body).activity_input[0];
    }

    it('stringifies functions and symbols (line 420)', async () => {
      const out = await sendAndReadInput({
        fn: function namedFn() {},
        sym: Symbol('label'),
      });
      expect(typeof out.fn).toBe('string');
      expect(out.fn).toContain('namedFn');
      expect(out.sym).toBe('Symbol(label)');
    });

    it('serializes Date values to ISO strings (line 425)', async () => {
      const out = await sendAndReadInput({
        when: new Date('2026-01-02T03:04:05.000Z'),
      });
      expect(out.when).toBe('2026-01-02T03:04:05.000Z');
    });

    it('serializes DataView values (lines 427, 466-469)', async () => {
      const dv = new DataView(new Uint8Array(Buffer.from('hello dv')).buffer);
      const out = await sendAndReadInput({ view: dv });
      expect(out.view).toBe('hello dv');
    });

    it('serializes a non-utf8 DataView to base64', async () => {
      const dv = new DataView(new Uint8Array([0xff, 0xfe]).buffer);
      const out = await sendAndReadInput({ view: dv });
      expect(out.view).toBe('//4=');
    });

    it('uses just the message for Errors with an empty name (line 423)', async () => {
      const err = new Error('plain message');
      err.name = '';
      const out = await sendAndReadInput({ err });
      expect(out.err).toBe('plain message');
    });

    it('honours a custom toJSON (lines 447-450)', async () => {
      const out = await sendAndReadInput({
        custom: { toJSON: () => ({ serialized: true }) },
      });
      expect(out.custom).toEqual({ serialized: true });
    });

    it('falls back to String when toJSON throws (lines 451-453)', async () => {
      const out = await sendAndReadInput({
        custom: {
          toJSON() {
            throw new Error('nope');
          },
          toString() {
            return 'custom-string';
          },
        },
      });
      expect(out.custom).toBe('custom-string');
    });

    it('serializes Maps and Sets', async () => {
      const out = await sendAndReadInput({
        m: new Map([['k', 'v']]),
        s: new Set(['a', 'b']),
      });
      expect(out.m).toEqual({ k: 'v' });
      expect(out.s).toEqual(['a', 'b']);
    });
  });

  // -------------------------------------------------------------------------
  // agent identity signing edge paths
  // -------------------------------------------------------------------------
  describe('agent identity signing', () => {
    it('signs and attaches DID headers when an identity is configured', async () => {
      const identity = makeAgentIdentity();
      const client = createClient({ agentIdentity: identity });
      fetchMock.mockResolvedValueOnce(mockResponse(200, {}));
      await client.validateApiKey();
      const headers = fetchMock.mock.calls[0][1].headers as Record<
        string,
        string
      >;
      expect(headers['X-OpenBox-Agent-DID']).toBe(identity.did);
      expect(headers['X-OpenBox-Agent-Signature']).toBeTruthy();
    });

    it('uses provided timestamp and nonce when supplied', () => {
      const identity = makeAgentIdentity();
      const headers = signAgentIdentityRequest({
        identity,
        method: 'post',
        path: '/api/v1/governance/evaluate',
        timestamp: '2026-06-06T00:00:00.000Z',
        nonce: 'fixed-nonce',
      });
      expect(headers['X-OpenBox-Agent-Timestamp']).toBe(
        '2026-06-06T00:00:00.000Z',
      );
      expect(headers['X-OpenBox-Agent-Nonce']).toBe('fixed-nonce');
    });

    it('generates timestamp and nonce when omitted', () => {
      const identity = makeAgentIdentity();
      const headers = signAgentIdentityRequest({
        identity,
        method: 'get',
        path: '/',
      });
      expect(headers['X-OpenBox-Agent-Timestamp']).toBeTruthy();
      expect(headers['X-OpenBox-Agent-Nonce']).toBeTruthy();
    });

    it('rejects an invalid DID', () => {
      expect(() =>
        validateAgentIdentityConfig({
          did: 'did:aip:not-a-uuid',
          privateKey: makeRawSeed(),
        }),
      ).toThrow(/did:aip:<uuid>/);
    });

    it('rejects a non-32-byte seed', () => {
      expect(() =>
        validateAgentIdentityConfig({
          did: `did:aip:${randomUUID()}`,
          privateKey: Buffer.from('too short').toString('base64'),
        }),
      ).toThrow(/32-byte Ed25519 key/);
    });

    it('rejects a non-canonical base64 seed encoding', () => {
      const identity = makeAgentIdentity();
      expect(() =>
        validateAgentIdentityConfig({
          ...identity,
          privateKey: identity.privateKey.replace(/=+$/, ''),
        }),
      ).toThrow(/canonical base64 raw 32-byte Ed25519 key/);
    });

    it('trims surrounding whitespace from did and key', () => {
      const identity = makeAgentIdentity();
      const result = validateAgentIdentityConfig({
        did: `  ${identity.did}  `,
        privateKey: `  ${identity.privateKey}  `,
      });
      expect(result.did).toBe(identity.did);
      expect(result.privateKey).toBe(identity.privateKey);
    });
  });

  // -------------------------------------------------------------------------
  // runtime api key validation (365-377)
  // -------------------------------------------------------------------------
  describe('runtime api key validation', () => {
    it('skips key validation for the public root health path (line 224)', async () => {
      const client = createClient({ apiKey: '' });
      fetchMock.mockResolvedValueOnce(mockResponse(200, 'ok', 'text/plain'));
      await expect(client.health()).resolves.toBe('ok');
    });

    it('requires a key for authenticated paths', async () => {
      const client = createClient({ apiKey: '' });
      await expect(client.validateApiKey()).rejects.toThrow(
        'runtime API key is required',
      );
    });

    it('rejects org/backend keys', async () => {
      const client = createClient({ apiKey: `obx_key_${'a'.repeat(48)}` });
      await expect(client.validateApiKey()).rejects.toThrow(
        'not an org/backend key',
      );
    });

    it('rejects malformed runtime keys', async () => {
      const client = createClient({ apiKey: 'nope' });
      await expect(client.validateApiKey()).rejects.toThrow(
        'must match obx_live_ or obx_test_',
      );
    });
  });

  // -------------------------------------------------------------------------
  // pollApproval (201-208)
  // -------------------------------------------------------------------------
  describe('pollApproval', () => {
    it('POSTs to the approval endpoint and returns the response', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, { id: 'app-1', action: 'allow' }),
      );
      const result = await client.pollApproval({
        workflow_id: 'wf-1',
        run_id: 'run-1',
        activity_id: 'act-1',
      });
      expect(result.action).toBe('allow');
    });
  });
});
