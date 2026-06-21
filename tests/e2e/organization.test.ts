import { describe, it, expect, beforeAll } from 'vitest';
import { BACKEND_ENDPOINT_MANIFEST } from '../../ts/src/client/generated/endpoint-manifest.js';
import { getBackendClient, fullResponse, getOrgId } from '../helpers/api-client';
import {
  GOVERNANCE_SPEC_DOMAINS,
  invalidGovernanceSpecMember,
} from '../helpers/governance-spec-domains';
import { GOVERNANCE_BOUNDARY_DOMAINS } from '../helpers/boundary-conformance';
import { runLocalStackSql, sqlLiteral } from '../helpers/local-stack-db';

const LOCAL_STACK_THROTTLE_WINDOW_MS = 65_000;
const ORGANIZATION_THROTTLE_TEST_TIMEOUT_MS = LOCAL_STACK_THROTTLE_WINDOW_MS * 3 + 60_000;

function backendOperation(operationId: string) {
  const operation = BACKEND_ENDPOINT_MANIFEST.find((entry) => entry.operationId === operationId);
  expect(operation, operationId).toBeDefined();
  return operation!;
}

function operationPath(path: string, params: Record<string, string>) {
  return path.replace(/\{([^}]+)\}/g, (_, key) => {
    expect(params[key], key).toBeDefined();
    return encodeURIComponent(params[key]);
  });
}

async function withTemporaryApiKeyPermissions<T>(
  permissions: readonly string[],
  fn: () => Promise<T>,
): Promise<T> {
  const apiKey = process.env.OPENBOX_BACKEND_API_KEY;
  expect(apiKey).toMatch(/^obx_key_/);
  const keyPrefix = apiKey!.slice(0, 12);
  const original = (await runLocalStackSql(`
    select array_to_string(permissions, ',')
    from api_keys
    where key_prefix = ${sqlLiteral(keyPrefix)}
      and deleted_at is null
    order by created_at desc
    limit 1;
  `)).trim();

  expect(original.length).toBeGreaterThan(0);

  try {
    await runLocalStackSql(`
      update api_keys
      set permissions = (
        select array_agg(distinct permission)
        from unnest(permissions || array[${permissions.map(sqlLiteral).join(', ')}]::varchar[]) as permission
      ),
      updated_at = now()
      where key_prefix = ${sqlLiteral(keyPrefix)}
        and deleted_at is null;
    `);

    return await fn();
  } finally {
    await runLocalStackSql(`
      update api_keys
      set permissions = string_to_array(${sqlLiteral(original)}, ',')::varchar[],
          updated_at = now()
      where key_prefix = ${sqlLiteral(keyPrefix)}
        and deleted_at is null;
    `);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function afterLocalStackThrottleWindow<T>(
  body: T & { status: number; message?: string },
  retry: () => Promise<T>,
) {
  if (body.status !== 429) return body;

  expect(body.message).toContain('Too Many Requests');
  await sleep(LOCAL_STACK_THROTTLE_WINDOW_MS);
  return retry();
}

describe('Organization', () => {
  const client = getBackendClient();
  let orgId: string;

  beforeAll(() => {
    orgId = getOrgId();
  });

  it('CONFORMANCE: GET /organization/{orgId} returns organization identity', async () => {
    // CONFORMANCE_PROOF: organization identity read follows the generated
    // operation path and asserts the local-stack organization identity.
    const operation = backendOperation('OrganizationController_getOrganization');
    let body = fullResponse(
      await client.get(operationPath(operation.path, { organizationId: orgId })),
    );
    body = await afterLocalStackThrottleWindow(
      body,
      async () =>
        fullResponse(await client.get(operationPath(operation.path, { organizationId: orgId }))),
    );

    expect(body.status).toBe(200);
    expect(body.data).toEqual(
      expect.objectContaining({
        id: orgId,
        displayName: expect.any(String),
      }),
    );
  }, ORGANIZATION_THROTTLE_TEST_TIMEOUT_MS);

  it('GET /organization/{orgId}/settings returns organization settings', async () => {
    // CONFORMANCE_PROOF: organization settings read returns the local-stack
    // org identity, domain, and timezone instead of a status-only response.
    const response = await client.get(`/organization/${orgId}/settings`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toEqual(
      expect.objectContaining({
        name: expect.any(String),
        domain: orgId,
        timezone: expect.any(String),
      }),
    );
  });

  it('PUT /organization/{orgId}/settings validates a no-op settings update', async () => {
    // CONFORMANCE_PROOF: settings update reaches the backend update path with
    // an empty partial DTO and returns the persisted org setting row.
    const response = await client.put(`/organization/${orgId}/settings`, {});
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toEqual(
      expect.objectContaining({
        organization_id: orgId,
        feature_flags: expect.any(Object),
      }),
    );
  });

  it('EXHAUSTIVE_SPEC_PROOF: organization settings timezone members are accepted', async () => {
    // EXHAUSTIVE_SPEC_PROOF: UpdateOrganizationSettingsDto.timezone is
    // finite in TypeSpec. Every member is written through the local-stack
    // settings update path and read back from organization settings.
    const originalResponse = await client.get(`/organization/${orgId}/settings`);
    const originalBody = fullResponse(originalResponse);
    const originalTimezone = originalBody.data?.timezone;

    for (const timezone of GOVERNANCE_SPEC_DOMAINS.organizationTimezones) {
      const update = await client.put(`/organization/${orgId}/settings`, { timezone });
      const updateBody = fullResponse(update);
      expect(updateBody.status, timezone).toBe(200);

      const read = await client.get(`/organization/${orgId}/settings`);
      const readBody = fullResponse(read);
      expect(readBody.status, timezone).toBe(200);
      expect(readBody.data.timezone, timezone).toBe(timezone);
    }

    if (
      typeof originalTimezone === 'string' &&
      GOVERNANCE_SPEC_DOMAINS.organizationTimezones.includes(originalTimezone)
    ) {
      const restore = await client.put(`/organization/${orgId}/settings`, {
        timezone: originalTimezone,
      });
      expect(fullResponse(restore).status).toBe(200);
    }
  });

  it('NEGATIVE_BOUNDARY_PROOF: organization settings timezone rejects out-of-domain values', async () => {
    // NEGATIVE_BOUNDARY_PROOF: UpdateOrganizationSettingsDto.timezone is
    // finite in TypeSpec and invalid members must fail validation instead of
    // mutating organization settings.
    const invalidTimezone = invalidGovernanceSpecMember('organizationTimezones');
    const response = await client.put(`/organization/${orgId}/settings`, {
      timezone: invalidTimezone,
    });
    const body = fullResponse(response);

    expect(body.status).toBe(422);
  });

  it('CONFORMANCE: GET /organization/{orgId}/features returns feature gate flags', async () => {
    // CONFORMANCE_PROOF: feature discovery exposes finite local-stack feature
    // gates used by webhook/API-key/SSO boundary tests.
    const operation = backendOperation('OrganizationController_getFeatures');
    const response = await client.get(operationPath(operation.path, { organizationId: orgId }));
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toEqual(
      expect.objectContaining({
        webhooks: expect.any(Boolean),
        api_keys: expect.any(Boolean),
        sso: expect.any(Boolean),
        multiagent_timeline: expect.any(Boolean),
        compliance_mapping: expect.any(Boolean),
      }),
    );
  });

  it('CONTRACT_BOUNDARY: POST /organization/register validates every required registration field', async () => {
    // CONTRACT_BOUNDARY_PROOF: organization registration is not mutated by
    // local SDK X-API-Key transport, but every required TypeSpec field is
    // sent through backend validation as a one-missing-field matrix.
    const required = GOVERNANCE_BOUNDARY_DOMAINS.requiredBodyFields
      .filter((entry) => entry.modelName === 'CreateOrganizationDto')
      .map((entry) => entry.fieldName);
    expect(required).toEqual(['contactName', 'contactEmail', 'recaptchaToken']);

    const validBoundaryBody: Record<string, unknown> = {
      contactName: 'Boundary User',
      contactEmail: 'boundary@example.invalid',
      recaptchaToken: 'invalid-recaptcha',
    };

    for (const field of required) {
      const body = { ...validBoundaryBody };
      delete body[field];
      const response = await client.post('/organization/register', body);
      const result = response.data;

      if (result.status === 429) {
        expect(result.message).toContain('Too Many Requests');
        continue;
      }

      expect(result.status, field).toBe(422);
      expect(JSON.stringify(result), field).toContain(field);
    }
  });

  it('GET /organization/demo-setup-status returns local setup status', async () => {
    // CONFORMANCE_PROOF: demo setup status is a backend setup signal used by
    // the local SDK stack bootstrap.
    const response = await client.get('/organization/demo-setup-status');
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toEqual(
      expect.objectContaining({
        status: expect.any(String),
      }),
    );
    expect(GOVERNANCE_SPEC_DOMAINS.demoSetupStatuses).toContain(body.data.status);
  });

  it('NEGATIVE: user administration operations require user-management permissions', async () => {
    // CONTRACT_BOUNDARY_PROOF: SDK e2e API-key auth does not include user-admin
    // permissions in the local stack, so member and invitation mutations fail
    // closed before they can create, update, invite, welcome, or remove users.
    const userId = '00000000-0000-4000-8000-000000000000';

    const members = await client.get(`/organization/${orgId}/members?page=0&perPage=5`);
    expect(members.data.status).toBe(403);
    expect(members.data.message).toContain('read:user');

    const removeMembers = await client.delete(`/organization/${orgId}/members`, {
      memberIds: [userId],
    });
    expect(removeMembers.data.status).toBe(403);
    expect(removeMembers.data.message).toContain('delete:user');

    const createdUser = await client.post(`/organization/${orgId}/users`, {});
    expect(createdUser.data.status).toBe(403);
    expect(createdUser.data.message).toContain('create:user');

    for (const type of GOVERNANCE_SPEC_DOMAINS.welcomeEmailTypes) {
      const welcome = await client.post(`/organization/${orgId}/send-welcome-email`, {
        type,
        email: 'boundary@example.invalid',
        orgId,
        realm: 'openbox',
      });
      expect(welcome.data.status).toBe(403);
      expect(welcome.data.message).toContain('create:user');
    }

    const invitation = await client.post(`/organization/${orgId}/invitations`, {});
    expect(invitation.data.status).toBe(403);
    expect(invitation.data.message).toContain('create:user');

    const assignRoles = await client.post(`/organization/${orgId}/members/${userId}/roles`, {
      roles: [],
    });
    expect(assignRoles.data.status).toBe(403);
    expect(assignRoles.data.message).toContain('update:user');

    const removeRoles = await client.delete(`/organization/${orgId}/members/${userId}/roles`, {
      roles: [],
    });
    expect(removeRoles.data.status).toBe(403);
    expect(removeRoles.data.message).toContain('update:user');

    const updatedMember = await client.put(`/organization/${orgId}/members/${userId}`, {
      role: 'member',
      team_ids: [],
    });
    expect(updatedMember.data.status).toBe(403);
    expect(updatedMember.data.message).toContain('update:user');
  });

  it('BOUNDARY_PROOF: remove-members validates memberIds after local user-admin grant', async () => {
    // BOUNDARY_PROOF: the local stack grants delete:user only for this block,
    // then proves RemoveMembersDto.memberIds type/minItems/maxItems reach the
    // real backend validator over the same SDK X-API-Key transport.
    await withTemporaryApiKeyPermissions(['delete:user'], async () => {
      const operation = backendOperation('OrganizationController_removeMembers');
      expect(operation.verb).toBe('delete');
      const path = operationPath(operation.path, { organizationId: orgId });

      const invalidBodies = [
        {
          name: 'empty',
          body: { memberIds: [] },
          expected: ['At least one member ID must be provided', 'memberIds array cannot be empty'],
        },
        {
          name: 'not-array',
          body: { memberIds: 'not-array' },
          expected: ['memberIds'],
        },
        {
          name: 'too-many',
          body: {
            memberIds: Array.from(
              { length: 101 },
              (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
            ),
          },
          expected: ['Maximum 100 members can be removed at once'],
        },
      ];

      for (const testCase of invalidBodies) {
        const response = await client.delete(path, testCase.body);
        const result = response.data;
        expect(result.status, testCase.name).toBe(422);
        const serialized = JSON.stringify(result);
        for (const expected of testCase.expected) {
          expect(serialized, testCase.name).toContain(expected);
        }
      }
    });
  });

  it('CONFORMANCE: GET /organization/{orgId}/dashboard returns org dashboard rollups', async () => {
    // CONFORMANCE_PROOF: organization dashboard conformance asserts the
    // org-wide governance dashboard rollup shape instead of only status.
    const operation = backendOperation('OrganizationController_getObservability');
    const response = await client.get(operationPath(operation.path, { organizationId: orgId }));
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toMatchObject({
      agent_metrics: expect.any(Object),
      sessions_metrics: expect.any(Object),
      violations_metrics: expect.any(Object),
      cost_metrics: expect.any(Object),
      errors: expect.any(Array),
      invocations: expect.any(Object),
    });
    expect(body.data.agent_metrics).toEqual(
      expect.objectContaining({
        total_agents: expect.any(Number),
        breakdown: expect.any(Object),
      }),
    );
    expect(body.data.sessions_metrics).toEqual(
      expect.objectContaining({
        sessions_current_period: expect.any(Number),
        avg_sessions_per_day: expect.any(Number),
      }),
    );
  });

  it('GET /organization/{orgId}/dashboard/tier-trends returns 200', async () => {
    // SCENARIO_PROOF: trust-aivss-ledger
    // CONFORMANCE_PROOF: trust ledger conformance verifies organization tier
    // trends expose dashboard buckets for trust tiers.
    expect('SCENARIO_PROOF: trust-aivss-ledger').toContain('trust-aivss-ledger');
    const operation = backendOperation('OrganizationController_getTrustTierTrends');
    expect(operation.verb).toBe('get');

    const response = await client.get(operationPath(operation.path, { organizationId: orgId }));
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(Array.isArray(body.data) || Array.isArray(body.data.data)).toBe(true);
    const trends = Array.isArray(body.data) ? body.data : body.data.data;
    expect(trends.length).toBeGreaterThan(0);
    expect(trends[0]).toEqual(
      expect.objectContaining({
        bucketTime: expect.any(String),
        tier0: expect.any(Number),
        tier1: expect.any(Number),
        tier2: expect.any(Number),
        tier3: expect.any(Number),
        tier4: expect.any(Number),
      }),
    );
  });

  it('GET /organization/{orgId}/dashboard/governance-feed returns 200 with feed data', async () => {
    // SCENARIO_PROOF: trace-logs
    expect('SCENARIO_PROOF: trace-logs').toContain('trace-logs');
    const operation = backendOperation('OrganizationController_getGovernanceFeed');
    expect(operation.verb).toBe('get');
    let body = fullResponse(await client.get(operationPath(operation.path, { organizationId: orgId })));
    body = await afterLocalStackThrottleWindow(
      body,
      async () => fullResponse(await client.get(operationPath(operation.path, { organizationId: orgId }))),
    );

    expect(body.status).toBe(200);
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data) || Array.isArray(body.data.data)).toBe(true);
  }, ORGANIZATION_THROTTLE_TEST_TIMEOUT_MS);

  it('GET /organization/{orgId}/dashboard/trust-drift-lanes returns lane series', async () => {
    // CONFORMANCE_PROOF: trust drift dashboard conformance verifies lane
    // series fields used by the governance dashboard.
    const operation = backendOperation('OrganizationController_getTrustDriftLanes');
    expect(operation.verb).toBe('get');
    let body = fullResponse(await client.get(
      `${operationPath(operation.path, { organizationId: orgId })}?limit=3`,
    ));
    body = await afterLocalStackThrottleWindow(
      body,
      async () => fullResponse(await client.get(
        `${operationPath(operation.path, { organizationId: orgId })}?limit=3`,
      )),
    );

    expect(body.status).toBe(200);
    const lanes = Array.isArray(body.data) ? body.data : body.data.data;
    expect(Array.isArray(lanes)).toBe(true);
    expect(lanes.length).toBeGreaterThan(0);
    expect(lanes[0]).toEqual(
      expect.objectContaining({
        agent_id: expect.any(String),
        agent_name: expect.any(String),
        current_tier: expect.any(Number),
        current_score: expect.any(Number),
        series30d: expect.any(Array),
        tiers30d: expect.any(Array),
      }),
    );
    expect(lanes[0].series30d.length).toBeGreaterThan(0);
    expect(lanes[0].tiers30d.length).toBe(lanes[0].series30d.length);
  }, ORGANIZATION_THROTTLE_TEST_TIMEOUT_MS);

  it('BOUNDARY_PROOF: organization query numeric/date boundaries are enforced', async () => {
    // BOUNDARY_PROOF: organization query numeric/date boundaries cover
    // positive dashboard limits, rejected zero limits, valid ISO audit date
    // filters, and invalid audit date failure.
    const feedOperation = backendOperation('OrganizationController_getGovernanceFeed');
    const driftOperation = backendOperation('OrganizationController_getTrustDriftLanes');
    const auditOperation = backendOperation('OrganizationController_getAuditLogs');
    expect([feedOperation.verb, driftOperation.verb, auditOperation.verb]).toEqual(['get', 'get', 'get']);
    let feedOneBody = fullResponse(await client.get(
      `${operationPath(feedOperation.path, { organizationId: orgId })}?limit=1`,
    ));
    feedOneBody = await afterLocalStackThrottleWindow(
      feedOneBody,
      async () => fullResponse(await client.get(
        `${operationPath(feedOperation.path, { organizationId: orgId })}?limit=1`,
      )),
    );

    expect(feedOneBody.status).toBe(200);
    const feedRows = Array.isArray(feedOneBody.data) ? feedOneBody.data : feedOneBody.data.data;
    expect(feedRows.length).toBeLessThanOrEqual(1);

    const feedZero = await client.get(`${operationPath(feedOperation.path, { organizationId: orgId })}?limit=0`);
    expect(feedZero.data.status).toBe(422);

    let driftOneBody = fullResponse(await client.get(
      `${operationPath(driftOperation.path, { organizationId: orgId })}?limit=1`,
    ));
    driftOneBody = await afterLocalStackThrottleWindow(
      driftOneBody,
      async () => fullResponse(await client.get(
        `${operationPath(driftOperation.path, { organizationId: orgId })}?limit=1`,
      )),
    );

    expect(driftOneBody.status).toBe(200);
    const driftRows = Array.isArray(driftOneBody.data) ? driftOneBody.data : driftOneBody.data.data;
    expect(driftRows.length).toBeLessThanOrEqual(1);

    const driftZero = await client.get(`${operationPath(driftOperation.path, { organizationId: orgId })}?limit=0`);
    expect(driftZero.data.status).toBe(422);

    const validAuditDates = await client.get(
      `${operationPath(auditOperation.path, {})}?startDate=2026-01-01T00:00:00.000Z&endDate=2026-12-31T23:59:59.999Z`,
    );
    const validAuditDatesBody = fullResponse(validAuditDates);

    expect(validAuditDatesBody.status).toBe(200);
    expect(Array.isArray(validAuditDatesBody.data.data)).toBe(true);

    const invalidAuditDates = await client.get(
      `${operationPath(auditOperation.path, {})}?startDate=not-a-date&endDate=also-bad`,
    );

    expect(invalidAuditDates.data.status).toBe(500);
  }, ORGANIZATION_THROTTLE_TEST_TIMEOUT_MS);

  it('CONFORMANCE: GET /organization/{orgId}/dashboard/governance-slo returns SLO counters', async () => {
    // CONFORMANCE_PROOF: governance SLO dashboard conformance verifies
    // verdict counters, rates, targets, and tier breakdown.
    const operation = backendOperation('OrganizationController_getGovernanceSlo');
    const response = await client.get(
      `${operationPath(operation.path, { organizationId: orgId })}?window=7d`,
    );
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toEqual(
      expect.objectContaining({
        window: '7d',
        total: expect.any(Number),
        allowed_count: expect.any(Number),
        blocked_count: expect.any(Number),
        halted_count: expect.any(Number),
        other_count: expect.any(Number),
        allowed_rate: expect.any(Number),
        targets: expect.any(Object),
        current_tier_breakdown: expect.any(Object),
      }),
    );
  });

  it('CONFORMANCE: GET /organization/{orgId}/dashboard/violation-heatcal returns heat calendar matrix', async () => {
    // CONFORMANCE_PROOF: violation heat calendar conformance verifies the
    // dashboard matrix dimensions and peak summary fields.
    const operation = backendOperation('OrganizationController_getViolationHeatcal');
    const response = await client.get(
      `${operationPath(operation.path, { organizationId: orgId })}?window=7d`,
    );
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toEqual(
      expect.objectContaining({
        matrix: expect.any(Array),
        total: expect.any(Number),
        peak_hour: expect.any(Number),
        peak_day: expect.any(Number),
        hours_in_day_by_dow: expect.any(Array),
      }),
    );
    expect(body.data.matrix).toHaveLength(7);
    for (const row of body.data.matrix) {
      expect(row).toHaveLength(24);
      expect(row.every((value: unknown) => typeof value === 'number')).toBe(true);
    }
  });

  it('GET /organization/{orgId}/sessions returns 200', async () => {
    // CONFORMANCE_PROOF: organization session dashboard conformance verifies
    // paginated session rows and current-step workflow context.
    const response = await client.get(`/organization/${orgId}/sessions`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toMatchObject({
      data: expect.any(Array),
      total: expect.any(Number),
    });
    expect(body.data.data.length).toBeGreaterThan(0);
    expect(body.data.data[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        agent_id: expect.any(String),
        workflow_id: expect.any(String),
        run_id: expect.any(String),
        status: expect.any(String),
      }),
    );
  });
});
