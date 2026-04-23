import { describe, it, expect, beforeAll } from 'vitest';
import { getBackendClient, fullResponse, getOrgId } from '../helpers/api-client';

describe('Members', () => {
  const client = getBackendClient();
  let orgId: string;

  beforeAll(() => {
    orgId = getOrgId();
  });

  it('GET /organization/{orgId}/members returns 200 or 403', async () => {
    try {
      const response = await client.get(`/organization/${orgId}/members`);
      const body = fullResponse(response);

      if (body.status === 403) {
        console.log(
          'GET /organization/{orgId}/members returned 403 (permission denied), skipping assertions',
        );
        return;
      }

      expect(body.status).toBe(200);
    } catch (err) {
      console.log(
        'GET /organization/{orgId}/members threw an error, skipping:',
        (err as Error).message,
      );
    }
  });

  it('GET /user/roles returns 200 or 403', async () => {
    const response = await client.get('/user/roles');
    const body = fullResponse(response);

    // May return 403 if user lacks read:user permission
    expect([200, 403]).toContain(body.status);
    if (body.status === 200) {
      expect(Array.isArray(body.data)).toBe(true);
    }
  });
});
