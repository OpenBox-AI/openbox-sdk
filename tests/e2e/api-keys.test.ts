import { describe, it, expect } from 'vitest';
import { getBackendClient } from '../helpers/api-client';
import { GOVERNANCE_SPEC_DOMAINS } from '../helpers/governance-spec-domains';

describe('API Keys', () => {
  const client = getBackendClient();
  const apiKeyId = '00000000-0000-4000-8000-000000000000';

  it('NEGATIVE: API-key management endpoints reject API-key transport', async () => {
    // CONTRACT_BOUNDARY_PROOF: local-stack API-key CRUD is JWT-only. The SDK
    // e2e transport intentionally uses the project X-API-Key path, so every
    // API-key management operation must fail closed before mutation.
    // EXHAUSTIVE_SPEC_PROOF: every finite CreateApiKeyDto.permissions member
    // is sent through the create boundary as a single-member permission set.
    const list = await client.get('/api-key?page=0&perPage=5');
    expect(list.data.status).toBe(401);
    expect(list.data.message).toContain('requires JWT authentication');

    for (const permission of GOVERNANCE_SPEC_DOMAINS.apiKeyPermissions) {
      const created = await client.post('/api-key', {
        name: `e2e-api-key-boundary-${permission.replace(/[^a-z0-9]+/gi, '-')}`,
        permissions: [permission],
        description: 'local-stack boundary proof',
      });
      expect(created.data.status, permission).toBe(401);
      expect(created.data.message, permission).toContain('API keys are not accepted');
    }

    const read = await client.get(`/api-key/${apiKeyId}`);
    expect(read.data.status).toBe(401);
    expect(read.data.message).toContain('requires JWT authentication');

    const updated = await client.patch(`/api-key/${apiKeyId}`, {
      name: 'e2e-api-key-boundary-renamed',
      is_active: false,
    });
    expect(updated.data.status).toBe(401);
    expect(updated.data.message).toContain('API keys are not accepted');

    const deleted = await client.delete(`/api-key/${apiKeyId}`);
    expect(deleted.data.status).toBe(401);
    expect(deleted.data.message).toContain('requires JWT authentication');
  });
});
