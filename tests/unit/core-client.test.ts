import {
  createHash,
  generateKeyPairSync,
  verify,
} from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  OpenBoxCoreClient,
  CoreApiError,
  signAgentIdentityRequest,
  validateAgentIdentityConfig,
} from '../../ts/src/core-client/core-client.js';

const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function makeAgentIdentity() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateKeyDer = privateKey.export({
    format: 'der',
    type: 'pkcs8',
  }) as Buffer;
  const privateKeyRaw = privateKeyDer.subarray(ED25519_PKCS8_PREFIX.length);
  return {
    identity: {
      did: 'did:aip:00000000-0000-5000-8000-000000000000',
      privateKey: privateKeyRaw.toString('base64'),
    },
    publicKey,
  };
}

function mockResponse(
  status: number,
  body: unknown,
  contentType = 'application/json',
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': contentType }),
    json: () => Promise.resolve(body),
    text: () =>
      Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response;
}

describe('OpenBoxCoreClient', () => {
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

  function createClient(
    overrides?: Partial<ConstructorParameters<typeof OpenBoxCoreClient>[0]>,
  ) {
    return new OpenBoxCoreClient({
      apiKey: 'obx_live_test123',
      retry: { maxRetries: 0 },
      ...overrides,
    });
  }

  describe('construction', () => {
    it('uses OPENBOX_CORE_URL when apiUrl is not provided', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, 'hello world', 'text/plain'),
      );
      await client.health();
      expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:18081/');
    });

    it('uses custom URL', async () => {
      const client = createClient({ apiUrl: 'https://custom.core.com' });
      fetchMock.mockResolvedValueOnce(mockResponse(200, 'hello', 'text/plain'));
      await client.health();
      expect(fetchMock.mock.calls[0][0]).toBe('https://custom.core.com/');
    });

    it('rejects non-localhost http Core URLs', () => {
      expect(() =>
        createClient({ apiUrl: 'http://core.example.com' }),
      ).toThrow('OPENBOX_CORE_URL must use https:// unless it points at localhost.');
    });

    it('allows loopback http Core URLs for local development', async () => {
      const client = createClient({ apiUrl: 'http://127.0.0.1:18081/core/' });
      fetchMock.mockResolvedValueOnce(mockResponse(200, 'hello', 'text/plain'));
      await client.health();
      expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:18081/core/');
    });
  });

  describe('runtime API key validation', () => {
    it('allows public health checks without a runtime key', async () => {
      const client = createClient({ apiKey: '' });
      fetchMock.mockResolvedValueOnce(mockResponse(200, 'hello', 'text/plain'));
      await expect(client.health()).resolves.toBe('hello');
    });

    it('rejects missing runtime keys before authenticated Core calls', async () => {
      const client = createClient({ apiKey: '' });

      await expect(client.validateApiKey()).rejects.toThrow(
        'OpenBox Core runtime API key is required',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects org backend keys before authenticated Core calls', async () => {
      const client = createClient({ apiKey: `obx_key_${'a'.repeat(48)}` });

      await expect(client.validateApiKey()).rejects.toThrow(
        'not an org/backend key',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects malformed runtime keys before authenticated Core calls', async () => {
      const client = createClient({ apiKey: 'not-a-runtime-key' });

      await expect(client.validateApiKey()).rejects.toThrow(
        'must start with obx_live_ or obx_test_',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('health', () => {
    it('returns text response', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, 'hello world', 'text/plain'),
      );
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
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
        'Bearer obx_live_mykey',
      );
    });

    it('sets the SDK version header', async () => {
      const client = createClient({ apiKey: 'obx_live_mykey' });
      fetchMock.mockResolvedValueOnce(mockResponse(200, {}));
      await client.validateApiKey();
      expect(
        fetchMock.mock.calls[0][1].headers['X-OpenBox-SDK-Version'],
      ).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('marks Core calls as internal so governed fetch layers skip recursion', async () => {
      const client = createClient({ apiKey: 'obx_live_mykey' });
      fetchMock.mockResolvedValueOnce(mockResponse(200, {}));
      await client.validateApiKey();
      expect(fetchMock.mock.calls[0][1].headers['x-openbox-internal']).toBe(
        'true',
      );
    });

    it('sets the User-Agent header for Core calls', async () => {
      const client = createClient({ apiKey: 'obx_live_mykey' });
      fetchMock.mockResolvedValueOnce(mockResponse(200, {}));
      await client.validateApiKey();
      expect(fetchMock.mock.calls[0][1].headers['User-Agent']).toMatch(
        /^OpenBox-SDK\/\d+\.\d+\.\d+/,
      );
    });

    it('attaches signed agent identity headers when configured', async () => {
      const { identity } = makeAgentIdentity();
      const client = createClient({ agentIdentity: identity });
      fetchMock.mockResolvedValueOnce(mockResponse(200, {}));

      await client.validateApiKey();

      const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
      expect(headers['X-OpenBox-Agent-DID']).toBe(identity.did);
      expect(headers['X-OpenBox-Agent-Nonce']).toBeTruthy();
      expect(headers['X-OpenBox-Agent-Timestamp']).toBeTruthy();
      expect(headers['X-OpenBox-Body-SHA256']).toMatch(/^[a-f0-9]{64}$/);
      expect(headers['X-OpenBox-Agent-Signature']).toBeTruthy();
    });
  });

  describe('signAgentIdentityRequest', () => {
    it('builds a Core-verifiable Ed25519 signature over the canonical request', () => {
      const { identity, publicKey } = makeAgentIdentity();
      const headers = signAgentIdentityRequest({
        identity,
        method: 'post',
        path: '/api/v1/governance/evaluate',
        body: '{"ok":true}',
        timestamp: '2026-06-06T00:00:00.000Z',
        nonce: 'nonce-1',
      });
      const canonical = [
        'POST',
        '/api/v1/governance/evaluate',
        '2026-06-06T00:00:00.000Z',
        'nonce-1',
        headers['X-OpenBox-Body-SHA256'],
      ].join('\n');

      expect(headers['X-OpenBox-Agent-DID']).toBe(identity.did);
      expect(
        verify(
          null,
          Buffer.from(canonical),
          publicKey,
          Buffer.from(headers['X-OpenBox-Agent-Signature'], 'base64'),
        ),
      ).toBe(true);
    });

    it('rejects malformed raw private keys before making a request', () => {
      expect(() =>
        signAgentIdentityRequest({
          identity: {
            did: 'did:aip:550e8400-e29b-41d4-a716-446655440000',
            privateKey: Buffer.from('bad').toString('base64'),
          },
          method: 'GET',
          path: '/',
        }),
      ).toThrow(/32-byte Ed25519 key/);
    });

    it('rejects invalid DID and non-canonical private-key encodings', () => {
      const { identity } = makeAgentIdentity();
      expect(() =>
        validateAgentIdentityConfig({
          ...identity,
          did: 'did:aip:not-a-uuid',
        }),
      ).toThrow(/did:aip:<uuid>/);
      expect(() =>
        validateAgentIdentityConfig({
          ...identity,
          privateKey: identity.privateKey.replace(/=+$/, ''),
        }),
      ).toThrow(/canonical base64 raw 32-byte Ed25519 key/);
    });
  });

  describe('requestOperation', () => {
    it('signs the exact transmitted JSON body for falsy payload values', async () => {
      const { identity } = makeAgentIdentity();
      const client = createClient({ agentIdentity: identity });
      fetchMock.mockResolvedValueOnce(mockResponse(200, { ok: true }));

      await client.requestOperation('POST', '/api/v1/custom-operation', {
        data: false,
      });

      const request = fetchMock.mock.calls[0][1] as RequestInit & {
        headers: Record<string, string>;
      };
      expect(request.body).toBe('false');
      expect(request.headers['X-OpenBox-Body-SHA256']).toBe(
        createHash('sha256').update('false').digest('hex'),
      );
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
        workflow_type: 'unit-test',
        task_queue: 'langchain',
        source: 'workflow-telemetry',
        timestamp: new Date().toISOString(),
        activity_id: 'act-1',
        activity_type: 'my-activity',
      });

      expect(fetchMock.mock.calls[0][0]).toContain(
        '/api/v1/governance/evaluate',
      );
      expect(fetchMock.mock.calls[0][1].method).toBe('POST');
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
        event_type: 'ActivityStarted',
        workflow_id: 'wf-1',
        task_queue: 'langchain',
        sdk_version: expect.stringMatching(/^\d+\.\d+\.\d+/),
      });
      expect(result.verdict).toBe('ALLOW');
    });

    it('preserves an explicit SDK version payload value', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, { verdict: 'ALLOW', action: 'allow' }),
      );

      await client.evaluate({
        event_type: 'WorkflowStarted',
        workflow_id: 'wf-1',
        run_id: 'run-1',
        workflow_type: 'unit-test',
        task_queue: 'generic',
        source: 'workflow-telemetry',
        timestamp: new Date().toISOString(),
        sdk_version: '9.8.7',
      });

      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
        sdk_version: '9.8.7',
      });
    });

    it('sanitizes non-JSON governance payload values before sending', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, { verdict: 'ALLOW', action: 'allow' }),
      );
      const circular: Record<string, unknown> = {
        count: 42n,
        error: new Error('model failed'),
        labels: new Set(['a', 'b']),
        metadata: new Map([['k', 'v']]),
      };
      circular.self = circular;

      await client.evaluate({
        event_type: 'ActivityStarted',
        workflow_id: 'wf-1',
        run_id: 'run-1',
        workflow_type: 'unit-test',
        task_queue: 'langchain',
        source: 'workflow-telemetry',
        timestamp: new Date().toISOString(),
        activity_id: 'act-1',
        activity_type: 'my-activity',
        activity_input: [circular],
      });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.activity_input[0]).toMatchObject({
        count: '42',
        error: 'Error: model failed',
        labels: ['a', 'b'],
        metadata: { k: 'v' },
        self: '[Circular]',
      });
    });

    it('serializes binary governance payload values like official SDKs', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, { verdict: 'ALLOW', action: 'allow' }),
      );
      const arrayBuffer = new Uint8Array(Buffer.from('array buffer text')).buffer;

      await client.evaluate({
        event_type: 'ActivityCompleted',
        workflow_id: 'wf-1',
        run_id: 'run-1',
        workflow_type: 'unit-test',
        task_queue: 'langchain',
        source: 'workflow-telemetry',
        timestamp: new Date().toISOString(),
        activity_id: 'act-1',
        activity_type: 'my-activity',
        activity_input: [
          {
            validBytes: new Uint8Array(Buffer.from('hello bytes')),
            nodeBuffer: Buffer.from('buffer text'),
            arrayBuffer,
            invalidBytes: new Uint8Array([0xff, 0xfe]),
          },
        ],
      });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.activity_input[0]).toMatchObject({
        validBytes: 'hello bytes',
        nodeBuffer: 'buffer text',
        arrayBuffer: 'array buffer text',
        invalidBytes: '//4=',
      });
    });

    it('does not collapse repeated non-circular payload values as circular', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, { verdict: 'ALLOW', action: 'allow' }),
      );
      const repeated = { prompt: 'shared prompt value' };

      await client.evaluate({
        event_type: 'ActivityStarted',
        workflow_id: 'wf-1',
        run_id: 'run-1',
        workflow_type: 'unit-test',
        task_queue: 'langchain',
        source: 'workflow-telemetry',
        timestamp: new Date().toISOString(),
        activity_id: 'act-1',
        activity_type: 'my-activity',
        activity_input: [{ first: repeated, second: repeated }],
      });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.activity_input[0]).toMatchObject({
        first: { prompt: 'shared prompt value' },
        second: { prompt: 'shared prompt value' },
      });
    });
  });

  describe('pollApproval', () => {
    it('sends POST to governance/approval', async () => {
      const client = createClient();
      const response = { id: 'app-1', action: 'allow' };
      fetchMock.mockResolvedValueOnce(mockResponse(200, response));

      const result = await client.pollApproval({
        workflow_id: 'wf-1',
        run_id: 'run-1',
        activity_id: 'act-1',
      });

      expect(fetchMock.mock.calls[0][0]).toContain(
        '/api/v1/governance/approval',
      );
      expect(result.action).toBe('allow');
    });

    it('does not derive expired approval status from past expiration timestamps', async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-01-01T00:00:10.000Z'));
        const client = createClient();
        fetchMock.mockResolvedValueOnce(
          mockResponse(200, {
            id: 'app-1',
            action: 'require_approval',
            approval_expiration_time: '2026-01-01T00:00:09.000Z',
          }),
        );

        const result = await client.pollApproval({
          workflow_id: 'wf-1',
          run_id: 'run-1',
          activity_id: 'act-1',
        });

        const expired: boolean | undefined = result.expired;
        expect(expired).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it('preserves DB-style approval expiration timestamps without local expiry', async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-01-01T00:00:10.000Z'));
        const client = createClient();
        fetchMock.mockResolvedValueOnce(
          mockResponse(200, {
            id: 'app-1',
            action: 'require_approval',
            approval_expiration_time: '2026-01-01 00:00:09',
          }),
        );

        const result = await client.pollApproval({
          workflow_id: 'wf-1',
          run_id: 'run-1',
          activity_id: 'act-1',
        });

        expect(result).toMatchObject({
          action: 'require_approval',
          approval_expiration_time: '2026-01-01 00:00:09',
        });
        expect(result.expired).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('approval decisions', () => {
    it('does not expose the unmerged Core approval decision endpoint', () => {
      const client = createClient();

      expect('decideApproval' in client).toBe(false);
    });
  });

  describe('error handling', () => {
    it('throws CoreApiError on 401', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(
        mockResponse(401, { code: 401, message: 'invalid key' }),
      );
      await expect(client.validateApiKey()).rejects.toThrow(CoreApiError);
    });

    it('error has status and body', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(
        mockResponse(401, { code: 401, message: 'bad' }),
      );
      try {
        await client.validateApiKey();
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as CoreApiError).status).toBe(401);
        expect((err as CoreApiError).body).toEqual({
          code: 401,
          message: 'bad',
        });
      }
    });
  });
});
