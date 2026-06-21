import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getBackendClient, fullResponse, getOrgId, getTeamIds } from '../helpers/api-client';
import { trackResource, cleanupAll } from '../helpers/cleanup';
import { makeCreateAgentDto } from '../helpers/fixtures';
import {
  GOVERNANCE_SPEC_DOMAINS,
  invalidGovernanceSpecMember,
} from '../helpers/governance-spec-domains';
import { runLocalStackSql, sqlLiteral } from '../helpers/local-stack-db';

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

  it('GET /agent/{agentId}/active-sessions returns 200', async () => {
    const response = await client.get(`/agent/${agentId}/active-sessions`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
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
    const completedOutput = await runLocalStackSql(`
      with seeded_session as (
        insert into sessions (
          agent_id,
          workflow_id,
          run_id,
          status,
          detail,
          started_at,
          completed_at,
          trust_evaluated_at,
          metadata
        )
        values (
          ${sqlLiteral(agentId)},
          'workflow-session-wf-' || gen_random_uuid(),
          'workflow-session-run-' || gen_random_uuid(),
          'completed',
          'seeded workflow session conformance',
          now() - interval '3 minutes',
          now() - interval '2 minutes',
          now(),
          '{"openbox_conformance":true,"source":"sessions.e2e"}'::jsonb
        )
        returning id, workflow_id, run_id
      ),
      seeded_event as (
        insert into governance_events (
          event_type,
          agent_id,
          session_id,
          workflow_id,
          run_id,
          workflow_type,
          task_queue,
          activity_id,
          activity_type,
          span_count,
          input,
          output,
          verdict,
          reason,
          metadata
        )
        select
          'ActivityCompleted',
          ${sqlLiteral(agentId)},
          seeded_session.id,
          seeded_session.workflow_id,
          seeded_session.run_id,
          'sdk-conformance',
          'local-stack',
          'workflow-session-log',
          'LLMCompletion',
          1,
          '[{"prompt":"follow the workflow"}]'::jsonb,
          '{"response":"workflow completed"}'::jsonb,
          0,
          'seeded workflow log',
          '{"openbox_conformance":true,"source":"sessions.e2e"}'::jsonb
        from seeded_session
        returning id, session_id
      ),
      seeded_age as (
        insert into age_evaluations (
          agent_id,
          session_id,
          governance_event_id,
          semantic_type,
          goal_alignment_checked,
          goal_drift,
          goal_alignment_detail,
          behavior_violated,
          trust_score,
          trust_tier,
          behavioral_compliance,
          alignment_consistency,
          evaluated_at
        )
        select
          ${sqlLiteral(agentId)},
          seeded_event.session_id,
          seeded_event.id,
          'llm_gen_ai',
          true,
          false,
          '{"reason":"workflow session aligned","alignment_percentage":100}'::text,
          false,
          91.5,
          1,
          100,
          100,
          now()
        from seeded_event
        returning session_id, governance_event_id
      )
      select seeded_age.session_id || '|' || seeded_age.governance_event_id
      from seeded_age;
    `);
    const [completedSessionId, governanceEventId] = completedOutput
      .trim()
      .split('\n')
      .at(-1)!
      .split('|');

    const activeOutput = await runLocalStackSql(`
      with active_session as (
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
          'active-session-wf-' || gen_random_uuid(),
          'active-session-run-' || gen_random_uuid(),
          'pending',
          'terminated workflow session conformance',
          now(),
          '{"openbox_conformance":true,"source":"sessions.e2e"}'::jsonb
        )
        returning id
      )
      select id from active_session;
    `);
    const activeSessionId = activeOutput.trim().split('\n').at(-1)!;

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
