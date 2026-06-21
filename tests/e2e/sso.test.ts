import { describe, it, expect, beforeAll } from 'vitest';
import { getBackendClient, fullResponse, getOrgId } from '../helpers/api-client';
import { GOVERNANCE_SPEC_DOMAINS } from '../helpers/governance-spec-domains';

describe('SSO', () => {
  const client = getBackendClient();
  let orgId: string;

  beforeAll(() => {
    orgId = getOrgId();
  });

  it('NEGATIVE: SSO admin endpoints reject API-key transport', async () => {
    // CONTRACT_BOUNDARY_PROOF: local-stack SSO admin operations are JWT-only.
    // The SDK e2e path uses X-API-Key auth and must prove these operations
    // fail closed without configuring or removing SSO state.
    const config = await client.get('/sso');
    expect(config.data.status).toBe(401);
    expect(config.data.message).toContain('requires JWT authentication');

    const saml = await client.post('/sso/saml', {});
    expect(saml.data.status).toBe(401);
    expect(saml.data.message).toContain('API keys are not accepted');

    const oidc = await client.post('/sso/oidc', {});
    expect(oidc.data.status).toBe(401);
    expect(oidc.data.message).toContain('API keys are not accepted');

    const enforce = await client.put('/sso/enforce', {});
    expect(enforce.data.status).toBe(401);
    expect(enforce.data.message).toContain('requires JWT authentication');

    const metadata = await client.get('/sso/metadata');
    expect(metadata.data.status).toBe(401);
    expect(metadata.data.message).toContain('API keys are not accepted');

    const verify = await client.post('/sso/verify');
    expect(verify.data.status).toBe(401);
    expect(verify.data.message).toContain('requires JWT authentication');

    const removed = await client.delete('/sso');
    expect(removed.data.status).toBe(401);
    expect(removed.data.message).toContain('API keys are not accepted');
  });

  it('GET /sso/status returns public organization SSO status', async () => {
    // CONFORMANCE_PROOF: public SSO status is the SSO operation intentionally
    // reachable without JWT admin auth and must expose configured/enforced flags.
    // EXHAUSTIVE_SPEC_PROOF: SsoStatus.method is finite; observed non-null
    // local-stack values must be one of the TypeSpec members.
    const response = await client.get(`/sso/status?orgId=${orgId}`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toEqual(
      expect.objectContaining({
        exists: expect.any(Boolean),
        configured: expect.any(Boolean),
        enabled: expect.any(Boolean),
        enforced: expect.any(Boolean),
      }),
    );
    if (body.data.method !== undefined && body.data.method !== null) {
      expect(GOVERNANCE_SPEC_DOMAINS.ssoMethods).toContain(body.data.method);
    }
  });
});
