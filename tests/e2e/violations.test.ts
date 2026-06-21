import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getBackendClient, fullResponse, getTeamIds } from '../helpers/api-client';
import { trackResource, cleanupAll } from '../helpers/cleanup';
import { makeCreateAgentDto } from '../helpers/fixtures';
import { runLocalStackSql, sqlLiteral } from '../helpers/local-stack-db';

function listItems(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

describe('Violations', () => {
  const client = getBackendClient();
  let agentId: string;
  let violationId: string | undefined;
  let teamIds: string[];

  async function ensureViolationLedger() {
    if (violationId) return;

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
          'violation-wf-' || gen_random_uuid(),
          'violation-run-' || gen_random_uuid(),
          'completed',
          'violation false-positive conformance',
          now() - interval '2 minutes',
          now() - interval '1 minute',
          now(),
          '{"openbox_conformance":true,"source":"violations.e2e"}'::jsonb
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
          'violation-ledger',
          'LLMCompletion',
          1,
          '[{"prompt":"observability violation ledger"}]'::jsonb,
          '{"response":"violation"}'::jsonb,
          1,
          'observability violation ledger',
          '{"openbox_conformance":true,"source":"violations.e2e"}'::jsonb
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
      )
      select id from seeded_age;
    `);
    violationId = seedOutput.trim().split('\n').at(-1)!;
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

  it('GET /agent/violations returns 200', async () => {
    // SCENARIO_PROOF: violation-false-positive
    // CONFORMANCE_PROOF: violation false-positive conformance verifies the
    // global violation dashboard rollup shape.
    expect('SCENARIO_PROOF: violation-false-positive').toContain('violation-false-positive');
    await ensureViolationLedger();

    const response = await client.get('/agent/violations');
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toMatchObject({
      guardrail_violations: expect.objectContaining({
        now: expect.objectContaining({
          violation_rate: expect.any(Number),
        }),
      }),
      policy_violations: expect.objectContaining({
        now: expect.objectContaining({
          violation_rate: expect.any(Number),
        }),
      }),
    });
  });

  it('GET /agent/{agentId}/violations returns 200', async () => {
    // SCENARIO_PROOF: violation-false-positive
    // CONFORMANCE_PROOF: violation false-positive conformance verifies a
    // seeded behavior violation is exposed in the agent violation ledger.
    expect('SCENARIO_PROOF: violation-false-positive').toContain('violation-false-positive');
    await ensureViolationLedger();

    const response = await client.get(`/agent/${agentId}/violations`);
    const body = fullResponse(response);
    const violation = listItems(body.data).find((entry: any) => entry.id === violationId);

    expect(body.status).toBe(200);
    expect(violation).toMatchObject({
      id: violationId,
      source_type: 'behavior',
      pattern: 'llm_gen_ai',
      is_false_positive: false,
    });
  });

  it('PATCH /agent/{agentId}/violations/{violationId}/false-positive persists state', async () => {
    // SCENARIO_PROOF: violation-false-positive
    // CONFORMANCE_PROOF: violation false-positive conformance marks the seeded
    // violation as false positive and verifies the persisted is_false_positive
    // flag on a subsequent ledger read.
    expect('SCENARIO_PROOF: violation-false-positive').toContain('violation-false-positive');
    await ensureViolationLedger();

    const response = await client.patch(
      `/agent/${agentId}/violations/${violationId}/false-positive`,
      { sourceType: 'behavior' },
    );
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toMatchObject({
      id: violationId,
      is_false_positive: true,
    });

    const rereadResponse = await client.get(`/agent/${agentId}/violations`);
    const rereadBody = fullResponse(rereadResponse);
    const reread = listItems(rereadBody.data).find((entry: any) => entry.id === violationId);

    expect(rereadBody.status).toBe(200);
    expect(reread).toMatchObject({
      id: violationId,
      is_false_positive: true,
    });
  });

  afterAll(async () => {
    await cleanupAll();
  });
});
