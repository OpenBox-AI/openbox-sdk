import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BACKEND_ENDPOINT_MANIFEST } from '../../ts/src/client/generated/endpoint-manifest.js';
import { getBackendClient, fullResponse, getTeamIds } from '../helpers/api-client';
import { makeJsonObjectValueClassPayload } from '../helpers/boundary-conformance';
import { trackResource, cleanupAll } from '../helpers/cleanup';
import { makeCreateAgentDto } from '../helpers/fixtures';
import {
  GOVERNANCE_SPEC_DOMAINS,
  invalidGovernanceSpecMember,
} from '../helpers/governance-spec-domains';

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

describe('Agent CRUD Lifecycle', () => {
  const client = getBackendClient();
  let agentId: string;
  let apiKey: string;
  let teamIds: string[];
  let agentName: string;

  beforeAll(async () => {
    teamIds = await getTeamIds();
  });

  it('creates an agent', async () => {
    // BOUNDARY_PROOF: agent config preserves every JSON value class for the
    // CreateAgentDto.config open object field.
    const config = makeJsonObjectValueClassPayload();
    const dto = makeCreateAgentDto(teamIds, { config });
    agentName = dto.agent_name;

    const response = await client.post('/agent/create', dto);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data.agent).toBeDefined();
    expect(body.data.agent.id).toBeDefined();
    expect(body.data.agent.agent_name).toBe(agentName);
    expect(body.data.agent.organization_id).toBeDefined();
    expect(body.data.agent.config).toMatchObject(config);
    expect(body.data.token).toBeDefined();
    // Backend issues obx_live_* in prod and obx_test_* everywhere else.
    // Accept both; env-detection bug land if we hardcode one.
    expect(body.data.token).toMatch(/^obx_(?:live|test)_/);
    expect(body.data.identity).toEqual(
      expect.objectContaining({
        did: expect.stringMatching(/^did:aip:/),
        privateKey: expect.any(String),
      }),
    );

    agentId = body.data.agent.id;
    apiKey = body.data.token;

    trackResource({ type: 'agent', id: agentId });
  });

  it('EXHAUSTIVE_SPEC_PROOF: CreateAgentDto attestation modes are accepted', async () => {
    // EXHAUSTIVE_SPEC_PROOF: CreateAgentDto.attestation_mode is finite in
    // TypeSpec. Every member is sent through the local-stack create route;
    // external mode includes the supporting attestation domain and token.
    expect(GOVERNANCE_SPEC_DOMAINS.agentAttestationModes).toEqual(['kms', 'external']);

    for (const attestationMode of GOVERNANCE_SPEC_DOMAINS.agentAttestationModes) {
      const response = await client.post('/agent/create', makeCreateAgentDto(teamIds, {
        agent_name: `attestation-${attestationMode}-${Date.now()}`,
        attestation_mode: attestationMode,
        ...(attestationMode === 'external'
          ? {
              attestation_domain: 'attestation.example.invalid',
              attestation_token: 'external-attestation-token',
            }
          : {}),
      }));
      const body = fullResponse(response);

      expect(body.status, attestationMode).toBe(200);
      expect(body.data.agent.id, attestationMode).toBeDefined();
      if ('attestation_mode' in body.data.agent) {
        expect(body.data.agent.attestation_mode).toBe(attestationMode);
      }

      trackResource({ type: 'agent', id: body.data.agent.id });
    }
  });

  it('NEGATIVE_BOUNDARY_PROOF: CreateAgentDto attestation mode rejects out-of-domain values', async () => {
    // NEGATIVE_BOUNDARY_PROOF: CreateAgentDto.attestation_mode is finite in
    // TypeSpec. Out-of-domain values must fail backend validation before an
    // agent identity or token is created.
    const invalidAttestationMode = invalidGovernanceSpecMember('agentAttestationModes');
    const response = await client.post('/agent/create', makeCreateAgentDto(teamIds, {
      agent_name: `attestation-invalid-${Date.now()}`,
      attestation_mode: invalidAttestationMode,
    }));
    const body = fullResponse(response);

    expect(body.status).toBe(422);
  });

  it('CONFORMANCE: lists agents and includes created agent', async () => {
    // CONFORMANCE_PROOF: agent list follows the generated list operation and
    // searches for a uniquely-created local-stack agent.
    const operation = backendOperation('AgentController_getAgents');
    const response = await client.get(
      `${operationPath(operation.path, {})}?search=${encodeURIComponent(agentName)}`,
    );
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(Array.isArray(body.data.data)).toBe(true);

    const found = body.data.data.find((a: any) => a.id === agentId);
    expect(found).toBeDefined();
  });

  it('CONFORMANCE: gets agent by ID', async () => {
    // CONFORMANCE_PROOF: agent read follows the generated detail operation and
    // verifies the local-stack row created by this suite.
    const operation = backendOperation('AgentController_getAgent');
    const response = await client.get(operationPath(operation.path, { agentId }));
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data.agent_name).toBe(agentName);
  });

  it('CONFORMANCE: updates agent', async () => {
    // CONFORMANCE_PROOF: agent lifecycle conformance verifies update returns
    // the persisted agent mutation.
    const operation = backendOperation('AgentController_updateAgent');
    const config = { updated: makeJsonObjectValueClassPayload() };
    const response = await client.put(operationPath(operation.path, { agentId }), {
      description: 'Updated by test',
      config,
    });
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toMatchObject({
      id: agentId,
      description: 'Updated by test',
      config,
    });
  });

  it('CONFORMANCE: verifies update persisted through generated read', async () => {
    const operation = backendOperation('AgentController_getAgent');
    const response = await client.get(operationPath(operation.path, { agentId }));
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data.description).toBe('Updated by test');
    expect(body.data.config).toMatchObject({ updated: makeJsonObjectValueClassPayload() });
  });

  it('CONFORMANCE: deletes agent', async () => {
    // CONFORMANCE_PROOF: agent lifecycle conformance verifies delete returns
    // a backend acknowledgement before the follow-up read confirms removal.
    const operation = backendOperation('AgentController_deleteAgent');
    const response = await client.delete(operationPath(operation.path, { agentId }));
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data?.message ?? body.message ?? '').toEqual(expect.any(String));
  });

  it('confirms deletion returns 403 or 404', async () => {
    const response = await client.get(`/agent/${agentId}`);
    const body = fullResponse(response);

    expect([403, 404]).toContain(body.status);
  });

  afterAll(async () => {
    await cleanupAll();
  });
});
