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

function createCoreClient(apiKey: string, agentIdentity?: AgentIdentityForSigning): OpenBoxCoreClient {
  return new OpenBoxCoreClient({
    apiUrl: process.env.OPENBOX_CORE_URL || 'https://core.openbox.ai',
    apiKey,
    agentIdentity,
  });
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
    it('returns a response from the core API', async () => {
      const result = await client.health();
      expect(result).toBeDefined();
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

      expect(result).toBeDefined();
      expect(result.verdict).toBeDefined();
      expect(result.action).toBeDefined();
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

      expect(result).toBeDefined();
      // Core's verdict casing has varied between snake_case lowercase
      // (`allow`, `require_approval`) and SCREAMING_SNAKE (`ALLOW`,
      // `REQUIRE_APPROVAL`); accept either so the test rides through
      // the next casing flip without a code change.
      expect(typeof result.verdict).toBe('string');
      expect(['allow', 'constrain', 'require_approval', 'block', 'halt'])
        .toContain(String(result.verdict).toLowerCase());
    });
  });

  // =========================================================================
  // Approval polling
  // =========================================================================

  describe('approval polling', () => {
    it('polls approval status for a non-existent workflow', async () => {
      try {
        const result = await client.pollApproval({
          workflow_id: 'non-existent-wf',
          run_id: 'non-existent-run',
          activity_id: 'non-existent-act',
        });
        // May return an empty/default response or error depending on API behavior
        expect(result).toBeDefined();
      } catch (err) {
        // Some APIs return 404 for unknown approvals
        expect(err).toBeInstanceOf(CoreApiError);
      }
    });
  });

  afterAll(async () => {
    await cleanupAll();
  });
});
