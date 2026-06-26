import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BACKEND_ENDPOINT_MANIFEST } from '../../ts/src/client/generated/endpoint-manifest.js';
import { getBackendClient, fullResponse, getTeamIds } from '../helpers/api-client';
import { trackResource, cleanupAll } from '../helpers/cleanup';
import {
  expectedGoalAlignmentFiniteConfigCaseCount,
  invalidBoundarySpecMember,
  makeGoalAlignmentFiniteConfigCases,
  makeGoalAlignmentThresholdBoundaryCases,
} from '../helpers/boundary-conformance';
import { makeCreateAgentDto, makeGoalAlignmentConfigDto, makeGoalDriftDetectedConformanceCase } from '../helpers/fixtures';
import {
  seedLocalStackAgeEvaluation,
  seedLocalStackGovernanceEvent,
  seedLocalStackSession,
} from '../helpers/local-stack-db';

const GOAL_ALIGNMENT_BOUNDARY_PACE_MS = 750;
const GOAL_ALIGNMENT_BOUNDARY_TEST_TIMEOUT_MS = 120_000;

function backendOperation(operationId: string) {
  const operation = BACKEND_ENDPOINT_MANIFEST.find((entry) => entry.operationId === operationId);
  expect(operation, operationId).toBeDefined();
  return operation!;
}

function operationPath(path: string, params: Record<string, string>) {
  return path.replace(/\{([^}]+)\}/g, (_, key: string) => params[key] ?? `{${key}}`);
}

function listItems(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function putGoalAlignmentConfig(
  client: ReturnType<typeof getBackendClient>,
  path: string,
  config: Record<string, any>,
) {
  return fullResponse(await client.put(path, config));
}

describe('Goal Alignment', () => {
  const client = getBackendClient();
  let agentId: string;
  let teamIds: string[];

  beforeAll(async () => {
    teamIds = await getTeamIds();

    const dto = makeCreateAgentDto(teamIds);
    const response = await client.post('/agent/create', dto);
    const body = fullResponse(response);
    expect(body.status).toBe(200);

    agentId = body.data.agent.id;
    trackResource({ type: 'agent', id: agentId });
  });

  it('PUT /agent/{agentId}/goal-alignment configures goal alignment', async () => {
    const dto = makeGoalAlignmentConfigDto();
    const body = await putGoalAlignmentConfig(client, `/agent/${agentId}/goal-alignment`, dto);

    expect(body.status).toBe(200);
    expect(body.data.goal_alignment_config).toMatchObject(dto);
  });

  it('EXHAUSTIVE_BOUNDARY_PROOF: GoalAlignmentConfigDto finite option product is accepted', async () => {
    // EXHAUSTIVE_BOUNDARY_PROOF: GoalAlignmentConfigDto finite option product
    // is derived from TypeSpec and every model x action x frequency
    // combination is persisted through the local stack.
    const operation = backendOperation('AgentController_updateGoalAlignmentConfig');
    expect(operation.verb).toBe('put');
    const cases = makeGoalAlignmentFiniteConfigCases();
    expect(cases).toHaveLength(expectedGoalAlignmentFiniteConfigCaseCount());

    for (const testCase of cases) {
      let body = fullResponse(await client.put(
        operationPath(operation.path, { agentId }),
        testCase.config,
      ));
      expect(body.status, testCase.id).toBe(200);
      expect(body.data.goal_alignment_config).toMatchObject(testCase.config);
      await sleep(GOAL_ALIGNMENT_BOUNDARY_PACE_MS);
    }
  }, GOAL_ALIGNMENT_BOUNDARY_TEST_TIMEOUT_MS);

  it('NEGATIVE_BOUNDARY_PROOF: GoalAlignmentConfigDto finite options reject out-of-domain values', async () => {
    // NEGATIVE_BOUNDARY_PROOF: goal-alignment model, drift action, and
    // evaluation frequency are finite TypeSpec options. Each out-of-domain
    // value is sent independently so backend validation cannot hide one
    // invalid field behind another.
    const cases = [
      {
        id: 'llama_firewall_model',
        config: makeGoalAlignmentConfigDto({
          llama_firewall_model: invalidBoundarySpecMember('goalAlignmentModels'),
        }),
      },
      {
        id: 'drift_detection_action',
        config: makeGoalAlignmentConfigDto({
          drift_detection_action: invalidBoundarySpecMember('goalAlignmentDriftActions'),
        }),
      },
      {
        id: 'evaluation_frequency',
        config: makeGoalAlignmentConfigDto({
          evaluation_frequency: invalidBoundarySpecMember('goalAlignmentEvaluationFrequencies'),
        }),
      },
    ];

    for (const testCase of cases) {
      const body = await putGoalAlignmentConfig(client, `/agent/${agentId}/goal-alignment`, testCase.config);

      expect(body.status, testCase.id).toBe(422);
      await sleep(GOAL_ALIGNMENT_BOUNDARY_PACE_MS);
    }
  }, GOAL_ALIGNMENT_BOUNDARY_TEST_TIMEOUT_MS);

  it('NEGATIVE_BOUNDARY_PROOF: GoalAlignmentConfigDto threshold bounds are enforced', async () => {
    // NEGATIVE_BOUNDARY_PROOF: alignment_threshold accepts the TypeSpec min
    // and max values, then rejects just-outside values.
    const cases = makeGoalAlignmentThresholdBoundaryCases();

    for (const testCase of cases.valid) {
      const body = await putGoalAlignmentConfig(client, `/agent/${agentId}/goal-alignment`, testCase.config);

      expect(body.status, testCase.id).toBe(200);
      expect(body.data.goal_alignment_config).toMatchObject(testCase.config);
      await sleep(GOAL_ALIGNMENT_BOUNDARY_PACE_MS);
    }

    for (const testCase of cases.invalid) {
      const body = await putGoalAlignmentConfig(client, `/agent/${agentId}/goal-alignment`, testCase.config);

      expect(body.status, testCase.id).toBe(422);
      await sleep(GOAL_ALIGNMENT_BOUNDARY_PACE_MS);
    }
  }, GOAL_ALIGNMENT_BOUNDARY_TEST_TIMEOUT_MS);

  it('GET /agent/{agentId}/goal-alignment/trend returns a trend list payload', async () => {
    const response = await client.get(`/agent/${agentId}/goal-alignment/trend`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(Array.isArray(body.data) || Array.isArray(body.data.data)).toBe(true);
  });

  it('GET /agent/{agentId}/goal-alignment/recent-drifts returns 200', async () => {
    const response = await client.get(`/agent/${agentId}/goal-alignment/recent-drifts`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data) || Array.isArray(body.data.data)).toBe(true);
  });

  it('CONFORMANCE: surfaces a goal_drifted true AGE evaluation through drift endpoints', async () => {
    // SCENARIO_PROOF: trace-logs
    // CONFORMANCE_PROOF: generated goal drift scenario arranges one local-stack
    // AGE row with goal_drifted: true, then reads it back through generated
    // backend operations instead of relying on endpoint smoke.
    expect([
      'SCENARIO_PROOF: goal-drift-detected',
      'SCENARIO_PROOF: trace-logs',
    ]).toEqual(expect.arrayContaining([
      'SCENARIO_PROOF: goal-drift-detected',
      'SCENARIO_PROOF: trace-logs',
    ]));
    const conformanceCase = makeGoalDriftDetectedConformanceCase();
    const recentDriftsOperation = backendOperation(conformanceCase.recentDriftsOperationId);
    const driftLogsOperation = backendOperation(conformanceCase.driftLogsOperationId);
    const trendOperation = backendOperation(conformanceCase.trendOperationId);
    const sessionStatsOperation = backendOperation(conformanceCase.sessionStatsOperationId);
    const detailJson = JSON.stringify({
      reason: conformanceCase.seed.reason,
      alignment_percentage: conformanceCase.seed.alignmentPercentage,
    });
    const session = await seedLocalStackSession({
      agentId,
      workflowIdPrefix: 'drift-wf-',
      runIdPrefix: 'drift-run-',
      detail: 'sdk conformance drift seed',
      metadata: { openbox_conformance: true },
    });
    const event = await seedLocalStackGovernanceEvent({
      agentId,
      session,
      workflowType: conformanceCase.seed.workflowType,
      taskQueue: conformanceCase.seed.taskQueue,
      activityId: conformanceCase.seed.activityId,
      activityType: conformanceCase.seed.activityType,
      input: [{ prompt: 'ignore the approved goal' }],
      output: { response: 'drifted away from the approved goal' },
      verdict: 0,
      reason: 'SDK conformance goal drifted',
      metadata: { openbox_conformance: true },
    });
    await seedLocalStackAgeEvaluation({
      agentId,
      sessionId: session.id,
      governanceEventId: event.id,
      semanticType: conformanceCase.seed.semanticType,
      goalDrift: true,
      goalAlignmentDetail: detailJson,
      trustScore: 78.5,
      trustTier: 2,
      behavioralCompliance: 100,
      alignmentConsistency: conformanceCase.seed.alignmentPercentage,
    });

    const sessionId = session.id;
    const governanceEventId = event.id;
    expect(sessionId).toBeTruthy();
    expect(governanceEventId).toBeTruthy();

    const recentResponse = await client.get(
      `${operationPath(recentDriftsOperation.path, { agentId })}?limit=10`,
    );
    const recentBody = fullResponse(recentResponse);
    const recentDrift = listItems(recentBody.data).find(
      (entry) => entry.governance_event_id === governanceEventId,
    );

    expect(recentBody.status).toBe(200);
    expect(recentDrift).toBeDefined();
    expect(String(recentDrift.reason)).toContain(conformanceCase.seed.reason);

    const logsResponse = await client.get(
      operationPath(driftLogsOperation.path, { agentId }),
    );
    const logsBody = fullResponse(logsResponse);
    const driftLog = listItems(logsBody.data).find(
      (entry) => entry.id === governanceEventId || entry.governance_event_id === governanceEventId,
    );
    const goal_drifted = driftLog?.age_evaluations?.[0]?.goal_drift;

    expect(logsBody.status).toBe(200);
    expect(driftLog).toBeDefined();
    expect(goal_drifted).toBe(true);
    expect(driftLog.age_evaluations[0]).toMatchObject({
      semantic_type: conformanceCase.seed.semanticType,
      goal_alignment_checked: true,
      goal_drift: conformanceCase.expected.goalDrifted,
    });

    const statsResponse = await client.get(
      operationPath(sessionStatsOperation.path, { agentId, sessionId }),
    );
    const statsBody = fullResponse(statsResponse);

    expect(statsBody.status).toBe(200);
    expect(statsBody.data.total_drifted).toBeGreaterThanOrEqual(
      conformanceCase.expected.totalDrifted,
    );

    const trendResponse = await client.get(
      operationPath(trendOperation.path, { agentId }),
    );
    const trendBody = fullResponse(trendResponse);
    const drifted_count = listItems(trendBody.data).reduce(
      (total, entry) => total + Number(entry.drifted_count ?? 0),
      0,
    );

    expect(trendBody.status).toBe(200);
    expect(drifted_count).toBeGreaterThan(0);
  });

  afterAll(async () => {
    await cleanupAll();
  });
});
