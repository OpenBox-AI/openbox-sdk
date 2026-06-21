import { describe, it, expect, beforeAll } from 'vitest';
import { BACKEND_ENDPOINT_MANIFEST } from '../../ts/src/client/generated/endpoint-manifest.js';
import { getBackendClient, fullResponse, getOrgId } from '../helpers/api-client';
import { overMaxLengthString } from '../helpers/boundary-conformance';

function backendOperation(operationId: string) {
  const operation = BACKEND_ENDPOINT_MANIFEST.find((entry) => entry.operationId === operationId);
  expect(operation, operationId).toBeDefined();
  return operation!;
}

function operationPath(path: string, params: Record<string, string>) {
  return path.replace(/\{([^}]+)\}/g, (_, key) => {
    expect(params[key], key).toBeDefined();
    return encodeURIComponent(params[key]);
  });
}

describe('Teams', () => {
  const client = getBackendClient();
  let orgId: string;

  beforeAll(async () => {
    orgId = getOrgId();
  });

  it('GET /organization/{orgId}/teams returns 200 with data array', async () => {
    const response = await client.get(`/organization/${orgId}/teams`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toHaveProperty('data');
    expect(Array.isArray(body.data.data)).toBe(true);
  });

  it('GET /organization/{orgId}/teams/stats returns 200', async () => {
    // CONFORMANCE_PROOF: team stats expose local-stack team/member/agent
    // counters rather than only endpoint reachability.
    const response = await client.get(`/organization/${orgId}/teams/stats`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toEqual(
      expect.objectContaining({
        total_teams: expect.any(Number),
        new_teams_this_month: expect.any(Number),
        total_agents: expect.any(Number),
        active_agents: expect.any(Number),
        total_team_members: expect.any(Number),
      }),
    );
  });

  it('POST/PUT/DELETE /organization/{orgId}/teams manages a disposable team', async () => {
    // CONFORMANCE_PROOF: team lifecycle reaches create, update, and bulk
    // delete paths and cleans up the disposable team before the test exits.
    let teamId: string | undefined;

    try {
      const created = await client.post(`/organization/${orgId}/teams`, {
        name: `e2e-team-${Date.now()}`,
        icon: 'https://example.invalid/openbox-team-icon.png',
        description: 'local-stack lifecycle proof',
      });
      const createBody = fullResponse(created);
      expect(createBody.status).toBe(200);
      expect(createBody.data).toEqual(
        expect.objectContaining({
          id: expect.any(String),
        }),
      );
      teamId = createBody.data.id;

      const updated = await client.put(`/organization/${orgId}/teams/${teamId}`, {});
      const updateBody = fullResponse(updated);
      expect(updateBody.status).toBe(200);
      expect(updateBody.data).toEqual(
        expect.objectContaining({
          id: teamId,
          name: expect.any(String),
        }),
      );

      const deleted = await client.delete(`/organization/${orgId}/teams`, {
        ids: [teamId],
      });
      expect(fullResponse(deleted).status).toBe(200);
      teamId = undefined;
    } finally {
      if (teamId) {
        await client.delete(`/organization/${orgId}/teams`, { ids: [teamId] });
      }
    }
  });

  it('NEGATIVE_BOUNDARY_PROOF: team string maxLength fields reject over-limit values', async () => {
    // NEGATIVE_BOUNDARY_PROOF: CreateTeamDto name, description, and icon
    // maxLength annotations are extracted from TypeSpec and enforced by
    // local-stack validation.
    const cases = [
      {
        id: 'name',
        body: {
          name: overMaxLengthString('CreateTeamDto', 'name'),
          icon: 'https://example.invalid/openbox-team-icon.png',
          description: 'valid team description',
        },
      },
      {
        id: 'description',
        body: {
          name: `team-description-boundary-${Date.now()}`,
          icon: 'https://example.invalid/openbox-team-icon.png',
          description: overMaxLengthString('CreateTeamDto', 'description'),
        },
      },
      {
        id: 'icon',
        body: {
          name: `team-icon-boundary-${Date.now()}`,
          icon: overMaxLengthString('CreateTeamDto', 'icon'),
          description: 'valid team description',
        },
      },
    ];

    for (const testCase of cases) {
      const response = await client.post(`/organization/${orgId}/teams`, testCase.body);
      const body = fullResponse(response);

      expect(body.status, testCase.id).toBe(422);
    }
  });

  it('NEGATIVE: team member mutations validate non-empty user_ids', async () => {
    // CONTRACT_BOUNDARY_PROOF: add/remove team-member operations reach DTO
    // validation with a disposable team but do not attach any real members.
    let teamId: string | undefined;

    try {
      const created = await client.post(`/organization/${orgId}/teams`, {
        name: `e2e-team-member-boundary-${Date.now()}`,
        icon: 'https://example.invalid/openbox-team-icon.png',
        description: 'local-stack member validation proof',
      });
      const createBody = fullResponse(created);
      expect(createBody.status).toBe(200);
      teamId = createBody.data.id;

      const addMembers = await client.post(`/organization/${orgId}/teams/${teamId}/members`, {
        user_ids: [],
      });
      expect(addMembers.data.status).toBe(422);
      expect(JSON.stringify(addMembers.data)).toContain('user_ids');

      const removeMembers = await client.delete(`/organization/${orgId}/teams/${teamId}/members`, {
        user_ids: [],
      });
      expect(removeMembers.data.status).toBe(422);
      expect(JSON.stringify(removeMembers.data)).toContain('user_ids');
    } finally {
      if (teamId) {
        await client.delete(`/organization/${orgId}/teams`, { ids: [teamId] });
      }
    }
  });

  it('CONFORMANCE: GET team detail and members for a disposable team', async () => {
    // CONFORMANCE_PROOF: team detail and team-member reads use a test-created
    // team, so proof does not depend on preexisting local-stack fixtures.
    const createOperation = backendOperation('OrganizationController_createTeam');
    const detailOperation = backendOperation('OrganizationController_getTeam');
    const membersOperation = backendOperation('OrganizationController_getTeamMembers');
    const deleteOperation = backendOperation('OrganizationController_deleteTeams');
    expect([
      createOperation.verb,
      detailOperation.verb,
      membersOperation.verb,
      deleteOperation.verb,
    ]).toEqual(['post', 'get', 'get', 'delete']);
    let teamId: string | undefined;

    try {
      const created = await client.post(operationPath(createOperation.path, { organizationId: orgId }), {
        name: `e2e-team-detail-${Date.now()}`,
        icon: 'https://example.invalid/openbox-team-icon.png',
        description: 'local-stack team detail proof',
      });
      const createBody = fullResponse(created);
      expect(createBody.status).toBe(200);
      const createdTeamId = createBody.data.id as string;
      teamId = createdTeamId;

      const detailRes = await client.get(operationPath(detailOperation.path, { organizationId: orgId, teamId: createdTeamId }));
      const detailBody = fullResponse(detailRes);

      expect(detailBody.status).toBe(200);
      expect(detailBody.data).toEqual(
        expect.objectContaining({
          id: createdTeamId,
          name: expect.any(String),
        }),
      );

      const membersRes = await client.get(operationPath(membersOperation.path, { organizationId: orgId, teamId: createdTeamId }));
      const membersBody = fullResponse(membersRes);

      expect(membersBody.status).toBe(200);
      expect(Array.isArray(membersBody.data?.data ?? membersBody.data)).toBe(true);
    } finally {
      if (teamId) {
        await client.delete(operationPath(deleteOperation.path, { organizationId: orgId }), { ids: [teamId] });
      }
    }
  });
});
