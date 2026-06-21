import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenBoxClient } from '../../ts/src/client';
import {
  REQUEST_PREFLIGHT_RULES as BACKEND_REQUEST_PREFLIGHT_RULES,
} from '../../ts/src/client/generated/request-preflight.js';
import { OpenBoxCoreClient } from '../../ts/src/core-client';
import { invalidGovernanceSpecMember } from '../helpers/governance-spec-domains';

function backendClient(): OpenBoxClient {
  expect(process.env.OPENBOX_API_URL).toBeTruthy();
  expect(process.env.OPENBOX_BACKEND_API_KEY).toMatch(/^obx_key_/);
  return new OpenBoxClient({
    apiUrl: process.env.OPENBOX_API_URL,
    apiKey: process.env.OPENBOX_BACKEND_API_KEY,
    retry: { maxRetries: 0 },
    clientName: 'openbox-e2e-sdk-preflight-closure',
  });
}

function coreClient(): OpenBoxCoreClient {
  expect(process.env.OPENBOX_CORE_URL).toBeTruthy();
  expect(process.env.OPENBOX_API_KEY).toMatch(/^obx_(test|live)_/);
  return new OpenBoxCoreClient({
    apiUrl: process.env.OPENBOX_CORE_URL,
    apiKey: process.env.OPENBOX_API_KEY!,
    retry: { maxRetries: 0 },
  });
}

function baseGovernancePayload() {
  return {
    event_type: 'ActivityStarted',
    workflow_id: 'sdk-preflight-closure-wf',
    run_id: 'sdk-preflight-closure-run',
    workflow_type: 'sdk-preflight-closure',
    task_queue: 'local-stack',
    source: 'openbox-sdk-e2e',
    timestamp: new Date().toISOString(),
    activity_id: 'sdk-preflight-closure-activity',
    activity_type: 'tool_call',
  } as const;
}

describe('SDK semantic gap preflight closures', () => {
  const originalFetch = globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn(() => {
      throw new Error('SDK preflight closure should reject before transport');
    });
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('E2E_SDK_GAP_CLOSURE: approval-status-invalid-query-not-rejected', async () => {
    // AgentController_getPendingApprovals, AgentController_getApprovalHistory,
    // and OrganizationController_getApprovals are raw backend gaps today; the
    // generated public SDK wrappers must reject invalid status before fetch.
    const client = backendClient();
    const invalidStatus = invalidGovernanceSpecMember('approvalStatuses');

    await expect(
      client.getPendingApprovals('agent-1', { status: invalidStatus }),
    ).rejects.toMatchObject({
      name: 'RequestPreflightError',
      operationId: 'AgentController_getPendingApprovals',
      location: 'query.status',
    });
    await expect(
      client.getApprovalHistory('agent-1', { status: invalidStatus }),
    ).rejects.toMatchObject({
      name: 'RequestPreflightError',
      operationId: 'AgentController_getApprovalHistory',
      location: 'query.status',
    });
    await expect(
      client.getOrgApprovals('org-1', { status: invalidStatus }),
    ).rejects.toMatchObject({
      name: 'RequestPreflightError',
      operationId: 'OrganizationController_getApprovals',
      location: 'query.status',
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('E2E_SDK_GAP_CLOSURE: backend-agent-evaluations-query-boundaries-not-rejected', async () => {
    // AgentController_getAgentEvaluations is exposed as getAgentViolations.
    // Every generated query boundary must fail through SDK preflight before
    // the raw backend can accept the invalid query.
    const client = backendClient();
    const rule = BACKEND_REQUEST_PREFLIGHT_RULES.find(
      (entry) => entry.operationId === 'AgentController_getAgentEvaluations',
    );
    expect(rule?.query?.map((entry) => entry.name).sort()).toEqual([
      'page',
      'pattern',
      'perPage',
    ]);

    const invalidByQueryName: Record<string, unknown> = {
      page: -1,
      pattern: 'x'.repeat(
        Number(rule?.query?.find((entry) => entry.name === 'pattern')?.maxLength) + 1,
      ),
      perPage: 0,
    };

    for (const queryRule of rule?.query ?? []) {
      await expect(
        client.getAgentViolations('agent-1', {
          [queryRule.name]: invalidByQueryName[queryRule.name],
        }),
      ).rejects.toMatchObject({
        name: 'RequestPreflightError',
        operationId: 'AgentController_getAgentEvaluations',
        location: `query.${queryRule.name}`,
      });
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('E2E_SDK_GAP_CLOSURE: core governance request boundary raw gaps', async () => {
    // core-governance-attempt-min-not-rejected,
    // core-governance-timestamp-format-not-rejected, and
    // core-governance-cost-type-not-rejected remain raw Core gaps; the SDK
    // generated Core client must close each before transport.
    const client = coreClient();

    await expect(client.evaluate({
      ...baseGovernancePayload(),
      attempt: 0,
    })).rejects.toMatchObject({
      name: 'RequestPreflightError',
      operationId: 'evaluateGovernance',
      location: 'body.attempt',
    });

    await expect(client.evaluate({
      ...baseGovernancePayload(),
      timestamp: 'not-a-date-time',
    })).rejects.toMatchObject({
      name: 'RequestPreflightError',
      operationId: 'evaluateGovernance',
      location: 'body.timestamp',
    });

    await expect(client.evaluate({
      ...baseGovernancePayload(),
      cost_usd: 'not-a-number',
    } as any)).rejects.toMatchObject({
      name: 'RequestPreflightError',
      operationId: 'evaluateGovernance',
      location: 'body.cost_usd',
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
