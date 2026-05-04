import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { OpenBoxClient, OpenBoxApiError } from '../../ts/src/client/client.js';
import { getOrgId, getTeamIds } from '../helpers/api-client';
import { makeCreateAgentDto, makeCreateGuardrailDto } from '../helpers/fixtures';
import { makeExpiredToken } from '../helpers/jwt';

function createClient(): OpenBoxClient {
  return new OpenBoxClient({
    apiUrl: process.env.OPENBOX_API_URL,
    accessToken: process.env.ACCESS_TOKEN!,
    refreshToken: process.env.REFRESH_TOKEN || undefined,
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
      expect(result).toBeDefined();
    });

    it('getProfile returns user profile', async () => {
      const profile = (await client.getProfile()) as Record<string, unknown>;
      expect(profile).toBeDefined();
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
      expect(agent.agent_name).toBe(agentName);
    });

    it('updates agent', async () => {
      const result = await client.updateAgent(agentId, {
        description: 'Updated by OpenBoxClient e2e test',
      });
      expect(result).toBeDefined();
    });

    it('verifies update persisted', async () => {
      const agent = (await client.getAgent(agentId)) as Record<string, unknown>;
      expect(agent.description).toBe('Updated by OpenBoxClient e2e test');
    });

    it('deletes agent', async () => {
      const result = await client.deleteAgent(agentId);
      expect(result).toBeDefined();
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
      expect(guardrail).toBeDefined();
    });

    it('updates guardrail', async () => {
      const result = await client.updateGuardrail(guardrailAgentId, guardrailId, {
        description: 'Updated by e2e',
      });
      expect(result).toBeDefined();
    });

    it('deletes guardrail', async () => {
      const result = await client.deleteGuardrail(guardrailAgentId, guardrailId);
      expect(result).toBeDefined();
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

  // =========================================================================
  // Token refresh
  // =========================================================================

  describe('token refresh', () => {
    // Auto-refresh is DISABLED in the SDK (REFRESH_ENABLED=false in
    // ts/src/client/client.ts:157) because the upstream /auth/refresh is
    // broken end-to-end. With the flag off, the SDK never calls
    // onTokenRefresh; making any assertion that it does call would test
    // disabled behavior. The test mirrors the SDK contract: an expired
    // access token simply 401s rather than auto-refreshing.
    //
    // When the upstream fix ships, flip REFRESH_ENABLED to true and
    // restore this test to:
    //   await refreshClient.health();
    //   expect(onTokenRefresh).toHaveBeenCalled();
    it.skip('refreshes token when access token is expired (disabled; REFRESH_ENABLED=false)', async () => {
      const refreshToken = process.env.REFRESH_TOKEN;
      if (!refreshToken) return;
      const onTokenRefresh = vi.fn();
      const refreshClient = new OpenBoxClient({
        apiUrl: process.env.OPENBOX_API_URL,
        accessToken: makeExpiredToken(),
        refreshToken,
        onTokenRefresh,
      });
      const result = await refreshClient.health();
      expect(result).toBeDefined();
      expect(onTokenRefresh).toHaveBeenCalled();
    });
  });
});
