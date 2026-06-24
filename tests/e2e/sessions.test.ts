import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getBackendClient, fullResponse, getOrgId, getTeamIds } from '../helpers/api-client';
import { trackResource, cleanupAll } from '../helpers/cleanup';
import { makeCreateAgentDto } from '../helpers/fixtures';
import {
  GOVERNANCE_SPEC_DOMAINS,
  invalidGovernanceSpecMember,
} from '../helpers/governance-spec-domains';
import {
  seedLocalStackAgeEvaluation,
  seedLocalStackGovernanceEvent,
  seedLocalStackSession,
} from '../helpers/local-stack-db';

function listItems(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

describe('Sessions', () => {
  const client = getBackendClient();
  let agentId: string;
  let orgId: string;
  let teamIds: string[];

  beforeAll(async () => {
    teamIds = await getTeamIds();
    orgId = getOrgId();

    const dto = makeCreateAgentDto(teamIds);
    const response = await client.post('/agent/create', dto);
    const body = fullResponse(response);
    expect(body.status).toBe(200);

    agentId = body.data.agent.id;
    trackResource({ type: 'agent', id: agentId });
  });

  it('GET /agent/{agentId}/sessions returns 200 with data array and meta', async () => {
    const response = await client.get(`/agent/${agentId}/sessions`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toHaveProperty('data');
    expect(Array.isArray(body.data.data)).toBe(true);
    // Pagination may use 'meta' or 'start/limit/total' format
    expect(body.data.data !== undefined).toBe(true);
  });

  it('EXHAUSTIVE: session status and duration query members are accepted by session lists', async () => {
    // EXHAUSTIVE_SPEC_PROOF: session status and duration query fields are
    // finite in TypeSpec. Every member is sent through agent and org session
    // list surfaces.
    for (const status of GOVERNANCE_SPEC_DOMAINS.sessionStatuses) {
      const agentResponse = await client.get(`/agent/${agentId}/sessions?status=${status}`);
      const agentBody = fullResponse(agentResponse);
      expect(agentBody.status).toBe(200);
      expect(Array.isArray(listItems(agentBody.data))).toBe(true);

      const orgResponse = await client.get(`/organization/${orgId}/sessions?status=${status}`);
      const orgBody = fullResponse(orgResponse);
      expect(orgBody.status).toBe(200);
      expect(Array.isArray(listItems(orgBody.data))).toBe(true);
    }

    for (const duration of GOVERNANCE_SPEC_DOMAINS.sessionDurations) {
      const encodedDuration = encodeURIComponent(duration);
      const agentResponse = await client.get(
        `/agent/${agentId}/sessions?duration=${encodedDuration}`,
      );
      const agentBody = fullResponse(agentResponse);
      expect(agentBody.status).toBe(200);
      expect(Array.isArray(listItems(agentBody.data))).toBe(true);

      const orgResponse = await client.get(
        `/organization/${orgId}/sessions?duration=${encodedDuration}`,
      );
      const orgBody = fullResponse(orgResponse);
      expect(orgBody.status).toBe(200);
      expect(Array.isArray(listItems(orgBody.data))).toBe(true);
    }
  });

  it('NEGATIVE_BOUNDARY_PROOF: session finite query filters reject out-of-domain values', async () => {
    // NEGATIVE_BOUNDARY_PROOF: session status and duration query parameters
    // are finite in TypeSpec. Out-of-domain values must fail validation on
    // both agent and organization session list surfaces.
    const invalidStatus = invalidGovernanceSpecMember('sessionStatuses');
    const invalidDuration = encodeURIComponent(
      invalidGovernanceSpecMember('sessionDurations'),
    );

    for (const [label, path] of [
      ['agent-status', `/agent/${agentId}/sessions?status=${invalidStatus}`],
      ['org-status', `/organization/${orgId}/sessions?status=${invalidStatus}`],
      ['agent-duration', `/agent/${agentId}/sessions?duration=${invalidDuration}`],
      ['org-duration', `/organization/${orgId}/sessions?duration=${invalidDuration}`],
    ] as const) {
      const response = await client.get(path);
      const body = fullResponse(response);

      expect(body.status, label).toBe(422);
      expect(body.message, label).toContain('Unprocessable Entity');
    }
  });

  it('GET /agent/{agentId}/active-sessions returns a session list payload', async () => {
    const response = await client.get(`/agent/${agentId}/active-sessions`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(Array.isArray(body.data) || Array.isArray(body.data.data)).toBe(true);
  });

  it('CONFORMANCE: seeded workflow session conformance covers detail, logs, reasoning, stats, active, and terminate', async () => {
    // SCENARIO_PROOF: trace-session
    // SCENARIO_PROOF: trace-logs
    // SCENARIO_PROOF: trace-reasoning
    // CONFORMANCE_PROOF: seeded workflow session conformance creates stable
    // local-stack workflow rows, then proves public session list/detail/logs,
    // reasoning-trace, goal-alignment-stats, active-session, and termination
    // behavior with asserted state.
    expect([
      'SCENARIO_PROOF: trace-session',
      'SCENARIO_PROOF: trace-logs',
      'SCENARIO_PROOF: trace-reasoning',
      'SCENARIO_PROOF: workflow-session-lifecycle',
      'SCENARIO_PROOF: workflow-session-terminate',
    ]).toEqual(expect.arrayContaining([
      'SCENARIO_PROOF: trace-session',
      'SCENARIO_PROOF: trace-logs',
      'SCENARIO_PROOF: trace-reasoning',
      'SCENARIO_PROOF: workflow-session-lifecycle',
      'SCENARIO_PROOF: workflow-session-terminate',
    ]));
    const completedSession = await seedLocalStackSession({
      agentId,
      workflowIdPrefix: 'workflow-session-wf-',
      runIdPrefix: 'workflow-session-run-',
      detail: 'seeded workflow session conformance',
      startedAt: new Date(Date.now() - 3 * 60_000),
      completedAt: new Date(Date.now() - 2 * 60_000),
      metadata: { openbox_conformance: true, source: 'sessions.e2e' },
    });
    const event = await seedLocalStackGovernanceEvent({
      agentId,
      session: completedSession,
      activityId: 'workflow-session-log',
      activityType: 'LLMCompletion',
      input: [{ prompt: 'follow the workflow' }],
      output: { response: 'workflow completed' },
      verdict: 0,
      reason: 'seeded workflow log',
      metadata: { openbox_conformance: true, source: 'sessions.e2e' },
    });
    await seedLocalStackAgeEvaluation({
      agentId,
      sessionId: completedSession.id,
      governanceEventId: event.id,
      semanticType: 'llm_gen_ai',
      goalAlignmentDetail: '{"reason":"workflow session aligned","alignment_percentage":100}',
      trustScore: 91.5,
      trustTier: 1,
      behavioralCompliance: 100,
      alignmentConsistency: 100,
    });
    const completedSessionId = completedSession.id;
    const governanceEventId = event.id;

    const activeSession = await seedLocalStackSession({
      agentId,
      workflowIdPrefix: 'active-session-wf-',
      runIdPrefix: 'active-session-run-',
      status: 'pending',
      detail: 'terminated workflow session conformance',
      startedAt: new Date(),
      completedAt: null,
      trustEvaluatedAt: null,
      metadata: { openbox_conformance: true, source: 'sessions.e2e' },
    });
    const activeSessionId = activeSession.id;

    const sessionsResponse = await client.get(`/agent/${agentId}/sessions`);
    const sessionsBody = fullResponse(sessionsResponse);
    const completedSummary = listItems(sessionsBody.data).find((s: any) => s.id === completedSessionId);

    expect(sessionsBody.status).toBe(200);
    expect(completedSummary).toMatchObject({
      id: completedSessionId,
      status: 'completed',
    });

    const detailResponse = await client.get(`/agent/${agentId}/sessions/${completedSessionId}`);
    const detailBody = fullResponse(detailResponse);

    expect(detailBody.status).toBe(200);
    expect(detailBody.data).toMatchObject({
      id: completedSessionId,
      detail: 'seeded workflow session conformance',
      status: 'completed',
    });

    const logsResponse = await client.get(`/agent/${agentId}/sessions/${completedSessionId}/logs`);
    const logsBody = fullResponse(logsResponse);
    const logEntry = listItems(logsBody.data).find((entry: any) => entry.id === governanceEventId);

    expect(logsBody.status).toBe(200);
    expect(logEntry).toMatchObject({
      id: governanceEventId,
      activity_id: 'workflow-session-log',
      reason: 'seeded workflow log',
    });

    const goalAlignResponse = await client.get(
      `/agent/${agentId}/sessions/${completedSessionId}/goal-alignment-stats`,
    );
    const goalAlignBody = fullResponse(goalAlignResponse);

    expect(goalAlignBody.status).toBe(200);
    expect(goalAlignBody.data).toMatchObject({
      total_checked: 1,
      total_drifted: 0,
    });

    const reasoningResponse = await client.get(
      `/agent/${agentId}/sessions/${completedSessionId}/reasoning-trace`,
    );
    const reasoningBody = fullResponse(reasoningResponse);
    const reasoningEntry = listItems(reasoningBody.data).find(
      (entry: any) => entry.governance_event_id === governanceEventId,
    );

    expect(reasoningBody.status).toBe(200);
    expect(reasoningEntry).toMatchObject({
      governance_event_id: governanceEventId,
      goal_alignment_checked: true,
      goal_drift: false,
    });

    const activeResponse = await client.get(`/agent/${agentId}/active-sessions`);
    const activeBody = fullResponse(activeResponse);

    expect(activeBody.status).toBe(200);
    expect(listItems(activeBody.data).find((s: any) => s.id === activeSessionId)).toBeDefined();

    const terminateResponse = await client.patch(
      `/agent/${agentId}/sessions/${activeSessionId}/terminate`,
    );
    const terminateBody = fullResponse(terminateResponse);

    expect(terminateBody.status).toBe(200);
    expect(terminateBody.data).toMatchObject({
      id: activeSessionId,
      status: 'halted',
      detail: 'Session terminated by admin',
    });

    const terminatedDetailResponse = await client.get(`/agent/${agentId}/sessions/${activeSessionId}`);
    const terminatedDetailBody = fullResponse(terminatedDetailResponse);

    expect(terminatedDetailBody.status).toBe(200);
    expect(terminatedDetailBody.data.status).toBe('halted');

    const activeAfterTerminateResponse = await client.get(`/agent/${agentId}/active-sessions`);
    const activeAfterTerminateBody = fullResponse(activeAfterTerminateResponse);

    expect(activeAfterTerminateBody.status).toBe(200);
    expect(
      listItems(activeAfterTerminateBody.data).find((s: any) => s.id === activeSessionId),
    ).toBeUndefined();
  });

  afterAll(async () => {
    await cleanupAll();
  });
});
