import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createConsumerClient } from '../../ts/src/client-factory/index.js';

describe('createConsumerClient', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('builds a client with explicit API URL, X-API-Key, and X-Openbox-Client', async () => {
    const ctx = await createConsumerClient({
      apiUrl: 'https://api.example/ob',
      coreUrl: 'https://core.example/ob',
      getApiKey: () => 'obx_key_test',
      clientName: 'apps/test',
    });
    expect(ctx.apiBase).toBe('https://api.example/ob');

    await ctx.client.health();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url.startsWith('https://api.example/ob')).toBe(true);
    const headers = init.headers as Record<string, string>;
    expect(headers['X-API-Key']).toBe('obx_key_test');
    expect(headers['X-Openbox-Client']).toBe('apps/test');
  });

  it('throws a uniform error when getApiKey returns undefined', async () => {
    await expect(
      createConsumerClient({
        apiUrl: 'https://api.example/ob',
        coreUrl: 'https://core.example/ob',
        getApiKey: () => undefined,
      }),
    ).rejects.toThrow(/no API key configured/);
  });
});
