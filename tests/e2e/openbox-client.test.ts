import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { OpenBoxClient, OpenBoxApiError } from '../../ts/src/client/client.js';
import { getOrgId, getTeamIds } from '../helpers/api-client';
import { makeCreateAgentDto, makeCreateGuardrailDto } from '../helpers/fixtures';

function createClient(): OpenBoxClient {
  return new OpenBoxClient({
    apiUrl: process.env.OPENBOX_API_URL,
    apiKey: process.env.OPENBOX_BACKEND_API_KEY!,
  });
}

describe('OpenBoxClient E2E', () => {
  let client: OpenBoxClient;
  let orgId: string;
  let teamIds: string[];

  beforeAll(async () => {
    client = createClient();
    orgId = getOrgId();
    teamIds = await getTeamIds();
  });

  // =========================================================================
  // Health & Auth
  // =========================================================================

  describe('health and auth', () => {
    it('health endpoint returns success', async () => {
      const result = await client.health();
      expect(result).toEqual('Success');
    });

    it('getProfile returns user profile', async () => {
      const profile = (await client.getProfile()) as Record<string, unknown>;
      expect(profile).toMatchObject({
        orgId,
        isApiKeyAuth: true,
        permissions: expect.any(Array),
      });
      expect(profile.sub || profile.email || profile.id).toBeDefined();
    });
  });

  // =========================================================================
  // Agent CRUD
  // =========================================================================

  describe('agent CRUD lifecycle', () => {
    let agentId: string;
    let agentName: string;

    it('creates an agent', async () => {
      const dto = makeCreateAgentDto(teamIds);
      agentName = dto.agent_name;

      const result = (await client.createAgent(dto)) as Record<string, unknown>;
      expect(result).toBeDefined();
      expect(result.agent).toBeDefined();

      const agent = result.agent as Record<string, unknown>;
      expect(agent.id).toBeDefined();
      expect(agent.agent_name).toBe(agentName);

      agentId = agent.id as string;
    });

    it('lists agents and finds created agent', async () => {
      // Narrow the search; default pagination excludes status=0 drafts, so
      // freshly-created agents may not surface on page 1 without a search.
      const result = (await client.listAgents({ search: agentName })) as unknown as Record<string, unknown>;
      const agents = result.data as Array<Record<string, unknown>>;
      expect(Array.isArray(agents)).toBe(true);

      const found = agents.find((a) => a.id === agentId);
      expect(found).toBeDefined();
    });

    it('gets agent by ID', async () => {
      const agent = (await client.getAgent(agentId)) as Record<string, unknown>;
      expect(agent).toMatchObject({
        id: agentId,
        agent_name: agentName,
      });
    });

    it('updates agent', async () => {
      const result = (await client.updateAgent(agentId, {
        description: 'Updated by OpenBoxClient e2e test',
      })) as Record<string, unknown>;
      expect(result).toMatchObject({
        id: agentId,
        description: 'Updated by OpenBoxClient e2e test',
      });
    });

    it('verifies update persisted', async () => {
      const agent = (await client.getAgent(agentId)) as Record<string, unknown>;
      expect(agent).toMatchObject({
        id: agentId,
        description: 'Updated by OpenBoxClient e2e test',
      });
    });

    it('deletes agent', async () => {
      const result = await client.deleteAgent(agentId);
      expect(result).toEqual({ status: 200 });
    });

    it('confirms deletion throws error', async () => {
      try {
        await client.getAgent(agentId);
        expect.fail('Should have thrown for deleted agent');
      } catch (err) {
        expect(err).toBeInstanceOf(OpenBoxApiError);
        expect([403, 404]).toContain((err as OpenBoxApiError).status);
      }
    });
  });

  // =========================================================================
  // Guardrail CRUD
  // =========================================================================

  describe('guardrail CRUD lifecycle', () => {
    let guardrailAgentId: string;
    let guardrailId: string;

    beforeAll(async () => {
      const dto = makeCreateAgentDto(teamIds);
      const result = (await client.createAgent(dto)) as Record<string, unknown>;
      guardrailAgentId = (result.agent as Record<string, unknown>).id as string;
    });

    it('creates a guardrail', async () => {
      const dto = makeCreateGuardrailDto();
      const result = (await client.createGuardrail(guardrailAgentId, dto)) as Record<
        string,
        unknown
      >;
      expect(result).toBeDefined();

      // The response may nest the guardrail under different keys
      const guardrail = (result.guardrail ?? result) as Record<string, unknown>;
      guardrailId = (guardrail.id ?? guardrail._id) as string;
      expect(guardrailId).toBeDefined();
    });

    it('lists guardrails and finds created guardrail', async () => {
      const result = (await client.listGuardrails(guardrailAgentId)) as unknown as Record<string, unknown>;
      const guardrails = (result.data ?? result) as Array<Record<string, unknown>>;
      expect(Array.isArray(guardrails)).toBe(true);

      const found = guardrails.find((g) => g.id === guardrailId || g._id === guardrailId);
      expect(found).toBeDefined();
    });

    it('gets guardrail by ID', async () => {
      const guardrail = (await client.getGuardrail(guardrailAgentId, guardrailId)) as Record<
        string,
        unknown
      >;
      expect(guardrail).toMatchObject({
        id: guardrailId,
        agent_id: guardrailAgentId,
      });
    });

    it('updates guardrail', async () => {
      const result = (await client.updateGuardrail(guardrailAgentId, guardrailId, {
        description: 'Updated by e2e',
      })) as Record<string, unknown>;
      expect(result).toMatchObject({
        id: guardrailId,
        agent_id: guardrailAgentId,
        description: 'Updated by e2e',
      });
    });

    it('deletes guardrail', async () => {
      const result = (await client.deleteGuardrail(guardrailAgentId, guardrailId)) as Record<
        string,
        unknown
      >;
      expect(result).toMatchObject({
        agent_id: guardrailAgentId,
        description: 'Updated by e2e',
      });
    });

    afterAll(async () => {
      try {
        await client.deleteAgent(guardrailAgentId);
      } catch {
        // cleanup best-effort
      }
    });
  });

  // =========================================================================
  // Error handling
  // =========================================================================

  describe('error handling', () => {
    it('throws OpenBoxApiError for non-existent agent', async () => {
      try {
        await client.getAgent('non-existent-agent-id-000');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(OpenBoxApiError);
        expect((err as OpenBoxApiError).status).toBeGreaterThanOrEqual(400);
        expect((err as OpenBoxApiError).body).toBeDefined();
      }
    });

    it('error message includes status code info', async () => {
      try {
        await client.getAgent('non-existent-agent-id-000');
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as OpenBoxApiError).message).toContain('Request failed');
      }
    });
  });
});
