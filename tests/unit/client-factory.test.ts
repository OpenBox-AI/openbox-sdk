import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ENVIRONMENTS } from '../../ts/src/env/index.js';
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

  it('builds a client with the env apiUrl, X-API-Key, and X-Openbox-Client', async () => {
    const ctx = await createConsumerClient({
      envName: 'production',
      getApiKey: () => 'obx_key_test',
      clientName: 'apps/test',
    });
    expect(ctx.apiBase).toBe(ENVIRONMENTS.production.apiUrl);
    expect(ctx.envName).toBe('production');

    await ctx.client.health();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url.startsWith(ENVIRONMENTS.production.apiUrl)).toBe(true);
    const headers = init.headers as Record<string, string>;
    expect(headers['X-API-Key']).toBe('obx_key_test');
    expect(headers['X-Openbox-Client']).toBe('apps/test');
  });

  it('accepts an async getApiKey (keychain reads)', async () => {
    const ctx = await createConsumerClient({
      envName: 'staging',
      getApiKey: async () => Promise.resolve('obx_key_async'),
    });
    await ctx.client.health();
    const headers = fetchSpy.mock.calls[0][1]!.headers as Record<string, string>;
    expect(headers['X-API-Key']).toBe('obx_key_async');
  });

  it('throws a uniform error when getApiKey returns undefined', async () => {
    await expect(
      createConsumerClient({ envName: 'production', getApiKey: () => undefined }),
    ).rejects.toThrow(/no API key configured.*production/);
  });

  it('throws a uniform error when getApiKey returns empty string', async () => {
    await expect(
      createConsumerClient({ envName: 'staging', getApiKey: () => '' }),
    ).rejects.toThrow(/no API key configured.*staging/);
  });

  it('falls back to default clientName when not specified', async () => {
    const ctx = await createConsumerClient({
      envName: 'local',
      getApiKey: () => 'obx_key_default',
    });
    await ctx.client.health();
    const headers = fetchSpy.mock.calls[0][1]!.headers as Record<string, string>;
    expect(headers['X-Openbox-Client']).toBe('openbox-sdk/client-factory');
  });
});
