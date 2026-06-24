import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenBoxClient } from '../../ts/src/client';
import {
  REQUEST_PREFLIGHT_RULES as BACKEND_REQUEST_PREFLIGHT_RULES,
} from '../../ts/src/client/generated/request-preflight.js';
import { OpenBoxCoreClient } from '../../ts/src/core-client';
import { invalidGovernanceSpecMember } from '../helpers/governance-spec-domains';
import {
  buildRequestConstraintConformance,
} from '../helpers/request-constraint-conformance';

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

describe('SDK request preflight closures', () => {
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

  it('E2E_SDK_PREFLIGHT: approval status invalid query rejects before transport', async () => {
    // The backend now rejects invalid approval statuses as well. Keep the
    // generated public SDK wrappers rejecting before fetch too.
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

  it('E2E_SDK_PREFLIGHT: backend agent evaluations query boundaries reject before transport', async () => {
    // AgentController_getAgentEvaluations is exposed as getAgentViolations.
    // Every generated query boundary must fail through SDK preflight before
    // transport.
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

  it('E2E_SDK_PREFLIGHT: core governance request boundaries reject before transport', async () => {
    // Core now rejects these raw request-boundary failures as well. Keep the
    // generated Core client rejecting before transport too.
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

  it('E2E_SDK_PREFLIGHT: no generated raw semantic gap constraints remain', async () => {
    const ledger = buildRequestConstraintConformance();

    expect(ledger.summary.knownRawSemanticGaps).toEqual([]);
    expect(ledger.summary.provenRawSemanticGapClosures).toEqual([]);
    expect(ledger.summary.missingRawSemanticGapClosures).toEqual([]);
    expect(ledger.constraints.filter(
      (entry) => entry.disposition === 'raw-semantic-gap-sdk-closed',
    )).toEqual([]);
  });
});
