import { describe, it, expect, beforeAll } from 'vitest';
import { BACKEND_ENDPOINT_MANIFEST } from '../../ts/src/client/generated/endpoint-manifest.js';
import { getBackendClient, fullResponse, getOrgId } from '../helpers/api-client';

function backendOperation(operationId: string) {
  const operation = BACKEND_ENDPOINT_MANIFEST.find((entry) => entry.operationId === operationId);
  expect(operation, operationId).toBeDefined();
  return operation!;
}

describe('Members', () => {
  const client = getBackendClient();
  let orgId: string;

  beforeAll(() => {
    orgId = getOrgId();
  });

  it('NEGATIVE: GET /organization/{orgId}/members requires read:user', async () => {
    // CONTRACT_BOUNDARY_PROOF: the local-stack SDK API key intentionally lacks
    // user-read permission, so member listing fails closed instead of
    // degrading to a status-only smoke assertion.
    const response = await client.get(`/organization/${orgId}/members?page=0&perPage=5`);
    const body = response.data;

    expect(body.status).toBe(403);
    expect(body.message).toContain('read:user');
  });

  it('NEGATIVE: GET /user/roles requires read:user', async () => {
    // CONTRACT_BOUNDARY_PROOF: role listing fails closed for the SDK X-API-Key
    // principal instead of accepting a status-only 200-or-403 branch.
    const operation = backendOperation('UserController_getRoles');
    expect(operation.verb).toBe('get');
    const response = await client.get(operation.path);
    const body = response.data;

    expect(body.status).toBe(403);
    expect(body.message).toContain('read:user');
  });
});
