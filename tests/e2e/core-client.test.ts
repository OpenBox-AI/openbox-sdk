import { describe, it, expect, beforeAll } from 'vitest';
import { OpenBoxCoreClient, CoreApiError } from '../../ts/src/core-client/core-client.js';

function createCoreClient(): OpenBoxCoreClient {
  const apiKey = process.env.OPENBOX_API_KEY;
  if (!apiKey) {
    throw new Error('OPENBOX_API_KEY is required for core e2e tests');
  }
  return new OpenBoxCoreClient({
    apiUrl: process.env.OPENBOX_CORE_URL || 'https://core.openbox.ai',
    apiKey,
  });
}

describe('OpenBoxCoreClient E2E', () => {
  let client: OpenBoxCoreClient;
  let hasApiKey: boolean;

  beforeAll(() => {
    hasApiKey = !!process.env.OPENBOX_API_KEY;
    if (!hasApiKey) {
      console.log('Skipping core e2e tests - no OPENBOX_API_KEY available');
      return;
    }
    client = createCoreClient();
  });

  // =========================================================================
  // Health
  // =========================================================================

  describe('health', () => {
    it('returns a response from the core API', async () => {
      if (!hasApiKey) return;
      const result = await client.health();
      expect(result).toBeDefined();
    });
  });

  // =========================================================================
  // Auth validation
  // =========================================================================

  describe('auth validation', () => {
    it('validates the API key', async () => {
      if (!hasApiKey) return;
      const result = await client.validateApiKey();
      expect(result).toBeDefined();
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
      if (!hasApiKey) return;

      const result = await client.evaluate({
        event_type: 'WorkflowStarted',
        workflow_id: `e2e-test-${Date.now()}`,
        run_id: `run-${Date.now()}`,
        workflow_type: 'e2e-test',
        source: 'workflow-telemetry',
        timestamp: new Date().toISOString(),
      });

      expect(result).toBeDefined();
      expect(result.verdict).toBeDefined();
      expect(result.action).toBeDefined();
    });

    it('evaluates an activity started event', async () => {
      if (!hasApiKey) return;

      const wfId = `e2e-test-${Date.now()}`;
      const runId = `run-${Date.now()}`;

      const result = await client.evaluate({
        event_type: 'ActivityStarted',
        workflow_id: wfId,
        run_id: runId,
        activity_id: `act-${Date.now()}`,
        activity_type: 'test-activity',
        source: 'workflow-telemetry',
        timestamp: new Date().toISOString(),
      });

      expect(result).toBeDefined();
      expect(['ALLOW', 'CONSTRAIN', 'REQUIRE_APPROVAL', 'BLOCK', 'HALT']).toContain(result.verdict);
    });
  });

  // =========================================================================
  // Approval polling
  // =========================================================================

  describe('approval polling', () => {
    it('polls approval status for a non-existent workflow', async () => {
      if (!hasApiKey) return;

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
});
