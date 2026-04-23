import { describe, it, expect, beforeAll } from 'vitest';
import { getBackendClient, fullResponse, getOrgId, getTeamIds } from '../helpers/api-client';

describe('Teams', () => {
  const client = getBackendClient();
  let orgId: string;
  let teamIds: string[];

  beforeAll(async () => {
    orgId = getOrgId();
    teamIds = await getTeamIds();
  });

  it('GET /organization/{orgId}/teams returns 200 with data array', async () => {
    const response = await client.get(`/organization/${orgId}/teams`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toHaveProperty('data');
    expect(Array.isArray(body.data.data)).toBe(true);
  });

  it('GET /organization/{orgId}/teams/stats returns 200', async () => {
    const response = await client.get(`/organization/${orgId}/teams/stats`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  it('GET team detail and members if teams exist', async () => {
    if (teamIds.length === 0) {
      console.log('No teams found, skipping team detail tests');
      return;
    }

    const detailRes = await client.get(`/organization/${orgId}/teams/${teamIds[0]}`);
    const detailBody = fullResponse(detailRes);

    expect(detailBody.status).toBe(200);
    expect(detailBody.data).toHaveProperty('name');

    const membersRes = await client.get(`/organization/${orgId}/teams/${teamIds[0]}/members`);
    const membersBody = fullResponse(membersRes);

    expect(membersBody.status).toBe(200);
  });
});
