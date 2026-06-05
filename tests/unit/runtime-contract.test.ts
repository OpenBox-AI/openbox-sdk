// Behavioral lock-down for the platform-specific runtime in
// ts/src/client/client.ts and ts/src/core-client/core-client.ts.
//
// What's hand-written vs spec-driven (audit):
//   ✅ types / DTOs / response models; from spec
//   ✅ wire methods (verb + path + body shape); from spec via wrapper-methods.ts
//   ✅ method coverage / drift detection; endpoint-coverage.test.ts
//   ⚠️ the `request()` method itself: fetch + retry + rate-limit + CSRF +
//     auth-header injection. This file pins down its observable behavior
//     so any reimplementation (TS or other language) must produce the
//     same wire output for the same inputs. That's what "deterministic +
//     reproducible" means for a hand-written runtime: anyone matching
//     these assertions ends up with a behaviorally-equivalent client.
//
// The fixtures below are tiny on purpose. They cover the load-bearing
// behaviors:
//   - Authorization header is `Bearer <accessToken>` for every call
//   - X-Openbox-Client header carries the resolved clientName
//   - Path is appended to baseUrl unmodified
//   - Body is JSON-serialized for non-GET, omitted for GET
//   - Query params are URL-encoded onto the path
//   - Successful response unwraps the `{ status, data }` envelope
//   - Non-2xx throws OpenBoxApiError carrying status + body
//
// Adding a new wire-format guarantee = add an assertion here. Removing
// one = ratchets the contract loosened, requires explicit review.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { OpenBoxClient, OpenBoxApiError } from '../../ts/src/client/client.js';
import { makeValidToken } from '../helpers/jwt';

describe('OpenBoxClient.request; runtime contract', () => {
  const fetchMock = vi.fn();
  let client: OpenBoxClient;
  const accessToken = makeValidToken();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    client = new OpenBoxClient({
      apiUrl: 'https://api.example/api',
      accessToken,
      clientName: 'openbox-cli',
    });
  });

  function lastCallInit(): RequestInit {
    return fetchMock.mock.calls.at(-1)![1] as RequestInit;
  }

  function lastCallUrl(): string {
    return fetchMock.mock.calls.at(-1)![0] as string;
  }

  function jsonOk(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('Authorization header is `Bearer <accessToken>` for every call', async () => {
    fetchMock.mockResolvedValue(jsonOk({ data: {} }));
    await client.getProfile();
    const headers = new Headers(lastCallInit().headers);
    expect(headers.get('authorization')).toBe(`Bearer ${accessToken}`);
  });

  it('X-Openbox-Client header carries the resolved client name', async () => {
    fetchMock.mockResolvedValue(jsonOk({ data: {} }));
    await client.getProfile();
    const headers = new Headers(lastCallInit().headers);
    expect(headers.get('x-openbox-client')).toBe('openbox-cli');
  });

  it('Path is appended to baseUrl unmodified', async () => {
    fetchMock.mockResolvedValue(jsonOk({ data: {} }));
    await client.getProfile();
    expect(lastCallUrl()).toBe('https://api.example/api/auth/profile');
  });

  it('Body is JSON-serialized for POST, omitted for GET', async () => {
    fetchMock.mockResolvedValue(jsonOk({ data: {} }));
    await client.getProfile();
    expect(lastCallInit().body).toBeUndefined();

    fetchMock.mockResolvedValue(jsonOk({ data: {} }));
    await client.changePassword({
      currentPassword: 'old',
      newPassword: 'new',
      orgId: 'org-1',
    });
    expect(lastCallInit().body).toBe(
      JSON.stringify({ currentPassword: 'old', newPassword: 'new', orgId: 'org-1' }),
    );
    expect(lastCallInit().method).toBe('POST');
  });

  it('Successful 2xx response unwraps the `{ status, data }` envelope', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk({ status: 'success', data: { sub: 'user-1', email: 'a@b' } }),
    );
    const profile = await client.getProfile();
    expect(profile).toEqual({ sub: 'user-1', email: 'a@b' });
  });

  it('Non-2xx throws OpenBoxApiError with status + body intact', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'forbidden' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    );
    let caught: unknown;
    try {
      await client.getProfile();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OpenBoxApiError);
    expect(caught).toMatchObject({
      name: 'OpenBoxApiError',
      status: 403,
      body: { message: 'forbidden' },
    });
  });

  it('Query params are URL-encoded onto the request URL', async () => {
    fetchMock.mockResolvedValue(jsonOk({ data: [] }));
    await client.listAgents({ page: 0, perPage: 50, search: 'hello world' });
    const url = lastCallUrl();
    expect(url).toContain('page=0');
    expect(url).toContain('perPage=50');
    expect(url).toContain('search=hello+world');
  });
});
