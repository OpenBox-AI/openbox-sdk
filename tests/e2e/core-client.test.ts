import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { OpenBoxCoreClient, CoreApiError } from '../../ts/src/core-client/core-client.js';
import {
  type AgentIdentityForSigning,
  getBackendClient,
  fullResponse,
  getTeamIds,
} from '../helpers/api-client';
import { trackResource, cleanupAll } from '../helpers/cleanup';
import { makeCreateAgentDto } from '../helpers/fixtures';
import { GOVERNANCE_SPEC_DOMAINS } from '../helpers/governance-spec-domains';

function createCoreClient(apiKey: string, agentIdentity?: AgentIdentityForSigning): OpenBoxCoreClient {
  return new OpenBoxCoreClient({
    apiUrl: process.env.OPENBOX_CORE_URL || 'https://core.openbox.ai',
    apiKey,
    agentIdentity,
  });
}

function expectRange(value: unknown, min: number, max: number, label: string) {
  expect(typeof value, label).toBe('number');
  expect(value as number, label).toBeGreaterThanOrEqual(min);
  expect(value as number, label).toBeLessThanOrEqual(max);
}

function expectGovernanceVerdictResponse(result: Record<string, unknown>) {
  expect(result).toMatchObject({
    governance_event_id: expect.any(String),
    verdict: expect.any(String),
    action: expect.any(String),
    risk_score: expect.any(Number),
    fallback_used: expect.any(Boolean),
  });
  expect(GOVERNANCE_SPEC_DOMAINS.coreVerdicts).toContain(result.verdict);
  expect(GOVERNANCE_SPEC_DOMAINS.coreLegacyActions).toContain(result.action);
  expectRange(result.risk_score, 0, 1, 'risk_score');
  if (result.trust_tier !== undefined && result.trust_tier !== null) {
    expectRange(result.trust_tier, 0, 4, 'trust_tier');
  }
  if (result.alignment_score !== undefined && result.alignment_score !== null) {
    expectRange(result.alignment_score, 0, 1, 'alignment_score');
  }
}

describe('OpenBoxCoreClient E2E', () => {
  const backendClient = getBackendClient();
  let client: OpenBoxCoreClient;
  let apiKey: string;
  let agentIdentity: AgentIdentityForSigning;

  beforeAll(async () => {
    const teamIds = await getTeamIds();
    const response = await backendClient.post('/agent/create', makeCreateAgentDto(teamIds));
    const body = fullResponse(response);

    expect(body.status).toBe(200);

    const agentId = body.data.agent.id;
    apiKey = body.data.token;
    agentIdentity = {
      did: body.data.identity.did,
      privateKey: body.data.identity.privateKey,
    };
    trackResource({ type: 'agent', id: agentId });
    client = createCoreClient(apiKey, agentIdentity);
  });

  // =========================================================================
  // Health
  // =========================================================================

  describe('health', () => {
    it('returns the literal core health response', async () => {
      const result = await client.health();
      expect(result).toEqual('hello world');
    });
  });

  // =========================================================================
  // Auth validation
  // =========================================================================

  describe('auth validation', () => {
    it('validates the API key', async () => {
      const result = (await client.validateApiKey()) as Record<string, unknown>;
      expect(result).toMatchObject({
        valid: true,
        agent_id: expect.any(String),
      });
    });

    it('throws CoreApiError for invalid API key', async () => {
      const badClient = new OpenBoxCoreClient({
        apiUrl: process.env.OPENBOX_CORE_URL || 'https://core.openbox.ai',
        apiKey: 'obx_live_invalid_key_000',
        retry: { maxRetries: 0 },
      });

      try {
        await badClient.validateApiKey();
        expect.fail('Should have thrown for invalid key');
      } catch (err) {
        expect(err).toBeInstanceOf(CoreApiError);
        expect((err as CoreApiError).status).toBeGreaterThanOrEqual(400);
      }
    });
  });

  // =========================================================================
  // Governance evaluation
  // =========================================================================

  describe('governance evaluation', () => {
    it('evaluates a workflow started event', async () => {
      const result = await client.evaluate({
        event_type: 'WorkflowStarted',
        workflow_id: `e2e-test-${Date.now()}`,
        run_id: `run-${Date.now()}`,
        workflow_type: 'e2e-test',
        task_queue: 'generic',
        source: 'workflow-telemetry',
        timestamp: new Date().toISOString(),
      });

      expectGovernanceVerdictResponse(result as unknown as Record<string, unknown>);
      expect(GOVERNANCE_SPEC_DOMAINS.coreVerdicts).toContain(result.verdict);
      expect(GOVERNANCE_SPEC_DOMAINS.coreLegacyActions).toContain(result.action);
      expect(result.risk_score).toBeGreaterThanOrEqual(0);
      expect(result.risk_score).toBeLessThanOrEqual(1);
    });

    it('evaluates an activity started event', async () => {
      const wfId = `e2e-test-${Date.now()}`;
      const runId = `run-${Date.now()}`;

      const result = await client.evaluate({
        event_type: 'ActivityStarted',
        workflow_id: wfId,
        run_id: runId,
        workflow_type: 'e2e-test',
        task_queue: 'generic',
        activity_id: `act-${Date.now()}`,
        activity_type: 'test-activity',
        source: 'workflow-telemetry',
        timestamp: new Date().toISOString(),
      });

      expectGovernanceVerdictResponse(result as unknown as Record<string, unknown>);
      expect(GOVERNANCE_SPEC_DOMAINS.coreVerdicts).toContain(result.verdict);
      expect(GOVERNANCE_SPEC_DOMAINS.coreLegacyActions).toContain(result.action);
      expect(result.risk_score).toBeGreaterThanOrEqual(0);
      expect(result.risk_score).toBeLessThanOrEqual(1);
    });
  });

  // =========================================================================
  // Approval polling
  // =========================================================================

  describe('approval polling', () => {
    it('returns CoreApiError not-found for a non-existent workflow', async () => {
      await expect(
        client.pollApproval({
          workflow_id: 'non-existent-wf',
          run_id: 'non-existent-run',
          activity_id: 'non-existent-act',
        }),
      ).rejects.toMatchObject({
        status: 404,
        body: {
          code: 404,
          message: 'governance event not found',
        },
      });
    });
  });

  afterAll(async () => {
    await cleanupAll();
  });
});
