import { describe, it, expect } from 'vitest';
import { getBackendClient, fullResponse, unwrap } from '../helpers/api-client';

describe('Auth Endpoints', () => {
  it('GET /auth/profile returns user profile with required fields', async () => {
    const client = getBackendClient();
    const response = await client.get('/auth/profile');
    const body = fullResponse(response);

    expect(body.status).toBe(200);

    const profile = body.data;
    expect(profile).toHaveProperty('sub');
    expect(profile).toHaveProperty('orgId');
    expect(profile).toHaveProperty('permissions');
    expect(Array.isArray(profile.permissions)).toBe(true);
    // X-API-Key auth surfaces a synthetic principal: sub starts with
    // `api-key:`, isApiKeyAuth is true, no email. JWT auth surfaces a
    // human user: sub is a UUID, email is set, isApiKeyAuth is absent.
    // SDK e2e dogfoods X-API-Key (mobile is the only sanctioned JWT
    // consumer) so assert the api-key shape here.
    expect(profile.sub).toMatch(/^api-key:/);
    expect(profile.isApiKeyAuth).toBe(true);
  });

  it('POST /auth/login with empty body returns 422 with validation errors', async () => {
    const client = getBackendClient();
    const response = await client.post('/auth/login', {});
    const body = response.data;

    expect(body.status).toBe(422);

    const message = JSON.stringify(body);
    expect(message).toContain('realm');
    expect(message).toContain('username');
    expect(message).toContain('password');
    expect(message).toContain('recaptchaToken');
  });

  it('GET /user/roles returns 200 or 403', async () => {
    const client = getBackendClient();
    const response = await client.get('/user/roles');
    const body = fullResponse(response);

    // May return 403 if user lacks read:user permission
    expect([200, 403]).toContain(body.status);
    if (body.status === 200) {
      expect(Array.isArray(body.data)).toBe(true);
    }
  });
});
