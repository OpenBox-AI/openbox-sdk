import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BACKEND_ENDPOINT_MANIFEST } from '../../ts/src/client/generated/endpoint-manifest.js';
import {
  REQUEST_PREFLIGHT_RULES as BACKEND_REQUEST_PREFLIGHT_RULES,
} from '../../ts/src/client/generated/request-preflight.js';
import {
  fullResponse,
  getBackendClient,
  getOrgId,
  getTeamIds,
} from '../helpers/api-client';
import { cleanupAll, trackResource } from '../helpers/cleanup';
import {
  makeCreateAgentDto,
  makeCreateBehaviorRuleDto,
  makeCreatePolicyDto,
} from '../helpers/fixtures';
import { runLocalStackSql, sqlLiteral } from '../helpers/local-stack-db';

interface QueryBoundaryCase {
  operationId: string;
  path: string;
  queryName: 'page' | 'perPage' | 'pattern';
  invalidValue: string;
  expectedStatuses: number[];
}

const TRANSPORT_OR_PERMISSION_GATED = new Set([
  'OrganizationController_getMembers',
]);

const RAW_SEMANTIC_GAP_OPERATIONS = new Set([
  'AgentController_getAgentEvaluations',
]);

function operationPath(path: string, params: Record<string, string>) {
  return path.replace(/\{([^}]+)\}/g, (_, key) => {
    expect(params[key], key).toBeDefined();
    return encodeURIComponent(params[key]);
  });
}

function backendOperation(operationId: string) {
  const operation = BACKEND_ENDPOINT_MANIFEST.find((entry) => entry.operationId === operationId);
  expect(operation, operationId).toBeDefined();
  return operation!;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function boundaryCases(params: Record<string, string>): QueryBoundaryCase[] {
  const cases: QueryBoundaryCase[] = [];
  const manifestByOperation = new Map<string, (typeof BACKEND_ENDPOINT_MANIFEST)[number]>(
    BACKEND_ENDPOINT_MANIFEST.map((entry) => [entry.operationId, entry]),
  );

  for (const rule of BACKEND_REQUEST_PREFLIGHT_RULES) {
    const operation = manifestByOperation.get(rule.operationId);
    if (!operation || operation.verb !== 'get') continue;
    if (rule.operationId.startsWith('ApiKeyController_')) continue;
    if (rule.operationId.startsWith('WebhookController_')) continue;

    for (const query of rule.query ?? []) {
      if (!['page', 'perPage', 'pattern'].includes(query.name)) continue;
      const queryName = query.name as QueryBoundaryCase['queryName'];
      const invalidValue =
        queryName === 'pattern'
          ? 'x'.repeat(Number(query.maxLength) + 1)
          : String(Number(query.minimum) - 1);
      cases.push({
        operationId: rule.operationId,
        path: operationPath(operation.path, params),
        queryName,
        invalidValue,
        expectedStatuses: RAW_SEMANTIC_GAP_OPERATIONS.has(rule.operationId)
          ? [200]
          : TRANSPORT_OR_PERMISSION_GATED.has(rule.operationId)
          ? [403]
          : [422],
      });
    }
  }

  return cases.sort((left, right) =>
    `${left.operationId}:${left.queryName}`.localeCompare(`${right.operationId}:${right.queryName}`),
  );
}

async function rawBoundaryGet(
  client: ReturnType<typeof getBackendClient>,
  testCase: QueryBoundaryCase,
) {
  const separator = testCase.path.includes('?') ? '&' : '?';
  const path = `${testCase.path}${separator}${testCase.queryName}=${encodeURIComponent(testCase.invalidValue)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.get(path);
    const body = fullResponse(response);
    if (body.status !== 429) return body;
    await sleep(65_000);
  }
  return fullResponse(await client.get(path));
}

describe('Generated Backend Query Boundaries', () => {
  const client = getBackendClient();
  let params: Record<string, string>;

  beforeAll(async () => {
    const orgId = getOrgId();
    const teamIds = await getTeamIds();
    const agentResponse = await client.post('/agent/create', makeCreateAgentDto(teamIds));
    const agentBody = fullResponse(agentResponse);
    expect(agentBody.status).toBe(200);
    const agentId = agentBody.data.agent.id;
    trackResource({ type: 'agent', id: agentId });

    const policyResponse = await client.post(
      `/agent/${agentId}/policies`,
      makeCreatePolicyDto({ trust_impact: 'none' }),
    );
    const policyBody = fullResponse(policyResponse);
    expect(policyBody.status).toBe(200);
    const policyId = policyBody.data.id;
    trackResource({ type: 'policy', id: policyId, agentId });

    const behaviorResponse = await client.post(
      `/agent/${agentId}/behavior-rule`,
      makeCreateBehaviorRuleDto({ trust_impact: 'none' }),
    );
    const behaviorBody = fullResponse(behaviorResponse);
    expect(behaviorBody.status).toBe(200);
    trackResource({ type: 'behavior-rule', id: behaviorBody.data.id, agentId });

    const sessionOutput = await runLocalStackSql(`
      insert into sessions (
        agent_id,
        workflow_id,
        run_id,
        status,
        detail,
        started_at,
        metadata
      )
      values (
        ${sqlLiteral(agentId)},
        'query-boundary-wf-' || gen_random_uuid(),
        'query-boundary-run-' || gen_random_uuid(),
        'completed',
        'query boundary conformance session',
        now(),
        '{"openbox_conformance":true,"source":"request-query-boundaries.e2e"}'::jsonb
      )
      returning id;
    `);
    const sessionId = sessionOutput.trim().split('\n').at(-1)!;

    params = {
      agentId,
      behaviorGroupdId: behaviorBody.data.base_rule_id ?? behaviorBody.data.id,
      organizationId: orgId,
      policyId,
      sessionId,
      teamId: teamIds[0] ?? '00000000-0000-4000-8000-000000000000',
    };
  });

  it('NEGATIVE_BOUNDARY_PROOF: generated backend pagination and search query constraints reject invalid values or expose raw gaps', async () => {
    // NEGATIVE_BOUNDARY_PROOF: every generated backend page/perPage/pattern
    // request preflight constraint is derived from OpenAPI, then driven
    // against the real local stack via the raw fallback path to distinguish
    // server validation from SDK-only preflight.
    // SEMANTIC_GAP_PROOF: AgentController_getAgentEvaluations accepts
    // page/perPage/pattern values outside the generated request constraints.
    const cases = boundaryCases(params);
    expect(cases).toHaveLength(55);
    expect(BACKEND_REQUEST_PREFLIGHT_RULES.length).toBeGreaterThan(0);
    expect(cases.some((testCase) => testCase.queryName === 'pattern')).toBe(true);
    expect(RAW_SEMANTIC_GAP_OPERATIONS.has('AgentController_getAgentEvaluations')).toBe(true);
    const semanticGapCases = cases.filter(
      (testCase) => testCase.operationId === 'AgentController_getAgentEvaluations',
    );
    expect(semanticGapCases.map((testCase) => testCase.queryName).sort()).toEqual([
      'page',
      'pattern',
      'perPage',
    ]);
    expect(semanticGapCases.every((testCase) => testCase.expectedStatuses.includes(200))).toBe(
      true,
    );
    const semanticGapOperation = backendOperation('AgentController_getAgentEvaluations');
    expect(semanticGapOperation.verb).toBe('get');

    const unexpected: Array<{
      operationId: string;
      queryName: string;
      expected: number[];
      actual: number;
      body: unknown;
    }> = [];

    for (const testCase of semanticGapCases) {
      expect(testCase.path).toBe(operationPath(semanticGapOperation.path, params));
      let body: ReturnType<typeof fullResponse> | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await client.get(
          `${operationPath(semanticGapOperation.path, params)}?${testCase.queryName}=${encodeURIComponent(testCase.invalidValue)}`,
        );
        body = fullResponse(response);
        if (body.status !== 429) break;
        await sleep(65_000);
      }
      expect(body).toBeDefined();
      if (!testCase.expectedStatuses.includes(body!.status)) {
        unexpected.push({
          operationId: testCase.operationId,
          queryName: testCase.queryName,
          expected: testCase.expectedStatuses,
          actual: body!.status,
          body,
        });
      }
      await sleep(750);
    }

    for (const testCase of cases.filter(
      (entry) => !RAW_SEMANTIC_GAP_OPERATIONS.has(entry.operationId),
    )) {
      const body = await rawBoundaryGet(client, testCase);
      if (!testCase.expectedStatuses.includes(body.status)) {
        unexpected.push({
          operationId: testCase.operationId,
          queryName: testCase.queryName,
          expected: testCase.expectedStatuses,
          actual: body.status,
          body,
        });
      }
      await sleep(750);
    }

    expect(unexpected).toEqual([]);
  }, 120_000);

  afterAll(async () => {
    await cleanupAll();
  });
});
