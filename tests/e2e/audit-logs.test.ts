import { describe, it, expect } from 'vitest';
import { BACKEND_ENDPOINT_MANIFEST } from '../../ts/src/client/generated/endpoint-manifest.js';
import { getBackendClient, fullResponse, getOrgId } from '../helpers/api-client';
import {
  GOVERNANCE_SPEC_DOMAINS,
  invalidGovernanceSpecMember,
} from '../helpers/governance-spec-domains';
import { runLocalStackSql, sqlLiteral } from '../helpers/local-stack-db';

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Audit Logs', () => {
  const client = getBackendClient();

  it('CONFORMANCE: seeded audit log list and detail are readable', async () => {
    // CONFORMANCE_PROOF: audit-log list/detail proof seeds its own row and
    // then reads it through generated operation paths.
    const listOperation = backendOperation('OrganizationController_getAuditLogs');
    const detailOperation = backendOperation('OrganizationController_getAuditLogById');
    expect([listOperation.verb, detailOperation.verb]).toEqual(['get', 'get']);
    let logId: string | undefined;

    try {
      const seedOutput = await runLocalStackSql(`
        insert into organization_audit_logs (
          organization_id,
          event_type,
          actor_id,
          actor_name,
          action,
          resource_type,
          result,
          details,
          created_at
        )
        values (
          ${sqlLiteral(getOrgId())},
          'security_event',
          'sdk-e2e-audit-detail',
          'OpenBox SDK',
          'sdk deterministic audit detail',
          'sdk_e2e',
          'success',
          '{"sdk_e2e": true}'::jsonb,
          now()
        )
        returning id;
      `);
      const seededLogId = seedOutput.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
      expect(seededLogId).toBeDefined();
      logId = seededLogId!;

      const response = await client.get(`${operationPath(listOperation.path, {})}?search=sdk%20deterministic%20audit%20detail`);
      const body = fullResponse(response);
      const logs = Array.isArray(body.data) ? body.data : body.data?.data;

      expect(body.status).toBe(200);
      expect(Array.isArray(logs)).toBe(true);
      expect(logs.some((entry: any) => entry.id === logId || entry._id === logId)).toBe(true);

      const detailRes = await client.get(operationPath(detailOperation.path, { logId }));
      const detailBody = fullResponse(detailRes);

      expect(detailBody.status).toBe(200);
      expect(detailBody.data).toMatchObject({
        id: logId,
        event_type: 'security_event',
        result: 'success',
      });
    } finally {
      if (logId) {
        await runLocalStackSql(`
          delete from organization_audit_logs
          where id = ${sqlLiteral(logId)}::uuid;
        `);
      }
    }
  });

  it('CONFORMANCE: audit log export lifecycle covers preview, create, status, download, history, and delete', async () => {
    // CONFORMANCE_PROOF: organization audit export conformance exercises the
    // export preview, async export creation, status, download URL, history,
    // delete, and deleted status paths with asserted state.
    const previewOperation = backendOperation('OrganizationController_previewExport');
    const exportOperation = backendOperation('OrganizationController_exportAuditLogs');
    const historyOperation = backendOperation('OrganizationController_getExportHistory');
    const deleteOperation = backendOperation('OrganizationController_deleteExport');
    const statusOperation = backendOperation('OrganizationController_getExportStatus');
    const downloadOperation = backendOperation('OrganizationController_downloadExport');
    expect([
      previewOperation.verb,
      exportOperation.verb,
      historyOperation.verb,
      deleteOperation.verb,
      statusOperation.verb,
      downloadOperation.verb,
    ]).toEqual(['post', 'post', 'get', 'delete', 'get', 'get']);

    const previewResponse = await client.post(previewOperation.path, {
      eventTypes: ['security_event'],
    });
    const previewBody = fullResponse(previewResponse);

    expect(previewBody.status).toBe(200);
    expect(previewBody.data).toMatchObject({
      count: expect.any(Number),
      timeRange: expect.any(Object),
      eventTypes: ['security_event'],
    });

    const exportName = `sdk-conformance-${Date.now()}`;
    const exportResponse = await client.post(exportOperation.path, {
      exportName,
      eventTypes: ['security_event'],
    });
    const exportBody = fullResponse(exportResponse);
    const exportId = exportBody.data.exportId ?? exportBody.data.id;

    expect(exportBody.status).toBe(200);
    expect(exportId).toEqual(expect.any(String));
    expect(exportBody.data).toMatchObject({
      status: expect.stringMatching(/pending|processing|completed/),
    });

    let statusBody: any;
    for (let attempt = 0; attempt < 10; attempt++) {
      const statusResponse = await client.get(operationPath(statusOperation.path, { exportId }));
      statusBody = fullResponse(statusResponse);
      if (statusBody.data.status === 'completed' || statusBody.data.status === 'failed') break;
      await sleep(500);
    }
    statusBody = statusBody!;

    expect(statusBody.status).toBe(200);
    expect(statusBody.data.exportId ?? statusBody.data.id).toBe(exportId);
    expect(statusBody.data).toEqual(
      expect.objectContaining({
        status: expect.stringMatching(/pending|processing|completed|failed/),
        totalRecords: expect.any(Number),
        processedRecords: expect.any(Number),
      }),
    );
    expect(statusBody.data.status).toBe('completed');

    const downloadResponse = await client.get(operationPath(downloadOperation.path, { exportId }));
    const downloadBody = fullResponse(downloadResponse);

    expect(downloadBody.status).toBe(200);
    expect(downloadBody.data).toEqual(
      expect.objectContaining({
        downloadUrl: expect.any(String),
        expiresIn: expect.any(Number),
      }),
    );
    expect(downloadBody.data.downloadUrl).toMatch(/^https?:\/\//);

    const historyResponse = await client.get(`${operationPath(historyOperation.path, {})}?page=0&perPage=10`);
    const historyBody = fullResponse(historyResponse);
    const historyRows = Array.isArray(historyBody.data) ? historyBody.data : historyBody.data.data;
    const historyExport = historyRows.find((entry: any) => entry.id === exportId || entry.exportId === exportId);

    expect(historyBody.status).toBe(200);
    expect(Array.isArray(historyRows)).toBe(true);
    expect(historyExport).toEqual(
      expect.objectContaining({
        status: expect.stringMatching(/pending|processing|completed|failed/),
      }),
    );

    const deleteResponse = await client.delete(operationPath(deleteOperation.path, { exportId }));
    const deleteBody = fullResponse(deleteResponse);

    expect(deleteBody.status).toBe(200);
    expect(deleteBody.data.message).toContain('deleted');

    const deletedStatusResponse = await client.get(operationPath(statusOperation.path, { exportId }));
    const deletedStatusBody = fullResponse(deletedStatusResponse);

    expect(deletedStatusBody.status).toBe(404);
  });

  it('EXHAUSTIVE: audit filters accept every finite event/result/status member', async () => {
    // EXHAUSTIVE_SPEC_PROOF: audit event types, audit results, and export
    // statuses are finite in TypeSpec. Every member is sent through the
    // corresponding local-stack query/body surface.
    const allPreviewResponse = await client.post('/organization/audit-logs/export/preview', {
      eventTypes: GOVERNANCE_SPEC_DOMAINS.auditEventTypes,
    });
    const allPreviewBody = fullResponse(allPreviewResponse);

    expect(allPreviewBody.status).toBe(200);
    expect(allPreviewBody.data.eventTypes).toEqual(GOVERNANCE_SPEC_DOMAINS.auditEventTypes);

    for (const eventType of GOVERNANCE_SPEC_DOMAINS.auditEventTypes) {
      const listResponse = await client.get(
        `/organization/audit-logs?eventType=${eventType}`,
      );
      const listBody = fullResponse(listResponse);
      expect(listBody.status).toBe(200);
      expect(Array.isArray(listBody.data?.data ?? listBody.data)).toBe(true);

      const previewResponse = await client.post('/organization/audit-logs/export/preview', {
        eventTypes: [eventType],
      });
      const previewBody = fullResponse(previewResponse);
      expect(previewBody.status).toBe(200);
      expect(previewBody.data.eventTypes).toEqual([eventType]);
    }

    for (const result of GOVERNANCE_SPEC_DOMAINS.auditResults) {
      const response = await client.get(`/organization/audit-logs?result=${result}`);
      const body = fullResponse(response);
      expect(body.status).toBe(200);
      expect(Array.isArray(body.data?.data ?? body.data)).toBe(true);
    }

    for (const status of GOVERNANCE_SPEC_DOMAINS.auditExportStatuses) {
      const response = await client.get(`/organization/audit-logs/exports?status=${status}`);
      const body = fullResponse(response);
      expect(body.status).toBe(200);
      expect(Array.isArray(body.data?.data ?? body.data)).toBe(true);
    }
  });

  it('NEGATIVE_BOUNDARY_PROOF: audit finite filters reject out-of-domain values', async () => {
    // NEGATIVE_BOUNDARY_PROOF: audit event type, result, and export status
    // finite domains come from TypeSpec. Invalid members must fail for list,
    // preview, export creation, and export-history query surfaces.
    const invalidEventType = invalidGovernanceSpecMember('auditEventTypes');
    const invalidResult = invalidGovernanceSpecMember('auditResults');
    const invalidExportStatus = invalidGovernanceSpecMember('auditExportStatuses');

    const invalidListEvent = await client.get(
      `/organization/audit-logs?eventType=${invalidEventType}`,
    );
    expect(fullResponse(invalidListEvent).status).toBe(422);

    const invalidPreview = await client.post('/organization/audit-logs/export/preview', {
      eventTypes: [invalidEventType],
    });
    expect(fullResponse(invalidPreview).status).toBe(422);

    const invalidExport = await client.post('/organization/audit-logs/export', {
      exportName: `invalid-audit-event-${Date.now()}`,
      eventTypes: [invalidEventType],
    });
    expect(fullResponse(invalidExport).status).toBe(422);

    const invalidResultResponse = await client.get(
      `/organization/audit-logs?result=${invalidResult}`,
    );
    expect(fullResponse(invalidResultResponse).status).toBe(422);

    const invalidExportStatusResponse = await client.get(
      `/organization/audit-logs/exports?status=${invalidExportStatus}`,
    );
    expect(fullResponse(invalidExportStatusResponse).status).toBe(422);
  });
});
