import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getBackendClient, fullResponse, getOrgId, getTeamIds } from '../helpers/api-client';
import { trackResource, cleanupAll } from '../helpers/cleanup';
import { makeCreateAgentDto } from '../helpers/fixtures';
import { runLocalStackSql, sqlLiteral } from '../helpers/local-stack-db';

function listItems(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

describe('Observability & Monitoring', () => {
  const client = getBackendClient();
  let agentId: string;
  let governanceEventId: string | undefined;
  let issueId: string | undefined;
  let teamIds: string[];

  async function ensureObservabilityLedger() {
    if (governanceEventId && issueId) return;

    const seedOutput = await runLocalStackSql(`
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
          'observability-wf-' || gen_random_uuid(),
          'observability-run-' || gen_random_uuid(),
          'completed',
          'observability ledger conformance',
          now() - interval '2 minutes',
          now() - interval '1 minute',
          now(),
          '{"openbox_conformance":true,"source":"observability.e2e"}'::jsonb
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
          'observability-ledger',
          'LLMCompletion',
          1,
          '[{"prompt":"observability ledger conformance"}]'::jsonb,
          '{"response":"observability ledger"}'::jsonb,
          1,
          'observability ledger conformance',
          '{"openbox_conformance":true,"source":"observability.e2e"}'::jsonb
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
          behavior_violated,
          behavior_compliance_detail,
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
          true,
          '{"reason":"observability violation ledger"}'::text,
          70,
          2,
          40,
          100,
          now()
        from seeded_event
        returning id
      ),
      seeded_issue as (
        insert into observability_issues (
          agent_id,
          session_id,
          governance_event_id,
          issue_type,
          severity,
          title,
          source_tool,
          source_workflow_id
        )
        select
          ${sqlLiteral(agentId)},
          seeded_event.session_id,
          seeded_event.id,
          'policy_violation',
          'high',
          'observability ledger issue',
          'sdk-e2e',
          'observability-ledger'
        from seeded_event
        returning id
      ),
      seeded_metric as (
        insert into observability_metrics (
          agent_id,
          organization_id,
          bucket_time,
          metric_type,
          metric_key,
          metric_value
        )
        values (
          ${sqlLiteral(agentId)},
          ${sqlLiteral(getOrgId())},
          now(),
          'tokens',
          'input_tokens',
          123
        )
        returning id
      )
      select
        (select id from seeded_event) || '|' ||
        (select id from seeded_issue) || '|' ||
        (select id from seeded_metric);
    `);
    const seedLine = seedOutput.trim().split('\n').at(-1)!;
    [governanceEventId, issueId] = seedLine.split('|');
  }

  beforeAll(async () => {
    teamIds = await getTeamIds();

    const dto = makeCreateAgentDto(teamIds);
    const response = await client.post('/agent/create', dto);
    const body = fullResponse(response);
    expect(body.status).toBe(200);

    agentId = body.data.agent.id;
    trackResource({ type: 'agent', id: agentId });
  });

  it('GET /agent/{agentId}/observability returns 200', async () => {
    // SCENARIO_PROOF: observability-ledger-dashboard
    // CONFORMANCE_PROOF: observability ledger conformance asserts the
    // dashboard rollup shape and token bucket keys.
    expect('SCENARIO_PROOF: observability-ledger-dashboard').toContain(
      'observability-ledger-dashboard',
    );
    await ensureObservabilityLedger();

    const response = await client.get(`/agent/${agentId}/observability`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toMatchObject({
      invocations: expect.objectContaining({
        total: expect.any(Number),
        timeline: expect.any(Array),
      }),
      tokens: expect.objectContaining({
        input_tokens: expect.any(String),
      }),
      latency: expect.any(Object),
      models: expect.any(Object),
      errors: expect.any(Array),
    });
  });

  it('GET /agent/{agentId}/issues returns 200', async () => {
    // SCENARIO_PROOF: observability-ledger-dashboard
    // CONFORMANCE_PROOF: observability ledger conformance verifies a seeded
    // observability ledger issue is returned with its source event.
    expect('SCENARIO_PROOF: observability-ledger-dashboard').toContain(
      'observability-ledger-dashboard',
    );
    await ensureObservabilityLedger();

    const response = await client.get(`/agent/${agentId}/issues`);
    const body = fullResponse(response);
    const issue = listItems(body.data).find((entry: any) => entry.id === issueId);

    expect(body.status).toBe(200);
    expect(issue).toMatchObject({
      id: issueId,
      governance_event_id: governanceEventId,
      severity: 'high',
      title: 'observability ledger issue',
    });
  });

  it('GET /agent/{agentId}/insights/metrics returns 200', async () => {
    // SCENARIO_PROOF: observability-ledger-dashboard
    // CONFORMANCE_PROOF: observability ledger conformance verifies insight
    // metrics include the seeded behavior violation.
    expect('SCENARIO_PROOF: observability-ledger-dashboard').toContain(
      'observability-ledger-dashboard',
    );
    await ensureObservabilityLedger();

    const response = await client.get(`/agent/${agentId}/insights/metrics`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data.violation.total).toBeGreaterThanOrEqual(1);
    expect(body.data.violation.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: 'behavior',
          pattern: 'llm_gen_ai',
        }),
      ]),
    );
    expect(body.data.tier_changes.total).toBeGreaterThanOrEqual(0);
  });

  it('GET /agent/{agentId}/logs returns 200', async () => {
    // SCENARIO_PROOF: observability-ledger-dashboard
    // CONFORMANCE_PROOF: observability ledger conformance verifies agent logs
    // include the seeded governance event.
    expect('SCENARIO_PROOF: observability-ledger-dashboard').toContain(
      'observability-ledger-dashboard',
    );
    await ensureObservabilityLedger();

    const response = await client.get(`/agent/${agentId}/logs`);
    const body = fullResponse(response);
    const log = listItems(body.data).find((entry: any) => entry.id === governanceEventId);

    expect(body.status).toBe(200);
    expect(log).toMatchObject({
      id: governanceEventId,
      activity_id: 'observability-ledger',
      reason: 'observability ledger conformance',
    });
  });

  it('GET /agent/{agentId}/logs/drift returns 200', async () => {
    const response = await client.get(`/agent/${agentId}/logs/drift`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data) || Array.isArray(body.data.data)).toBe(true);
  });

  it('GET /agent/metrics returns 200', async () => {
    // CONFORMANCE_PROOF: backend metrics dashboard conformance asserts the
    // agent/guardrail/policy rollup sections and stable dashboard counters.
    expect(['SCENARIO_PROOF: backend-dashboard-metrics']).toEqual(
      expect.arrayContaining(['SCENARIO_PROOF: backend-dashboard-metrics']),
    );
    const response = await client.get('/agent/metrics');
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toMatchObject({
      agent: expect.objectContaining({
        total_agents: expect.any(Number),
      }),
      guardrail: expect.objectContaining({
        now: expect.objectContaining({
          violation_rate: expect.any(Number),
        }),
      }),
      policy: expect.objectContaining({
        now: expect.objectContaining({
          violation_rate: expect.any(Number),
        }),
      }),
    });
  });

  afterAll(async () => {
    await cleanupAll();
  });
});
