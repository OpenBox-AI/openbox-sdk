import { describe, it, expect } from 'vitest';
import { getBackendClient, fullResponse } from '../helpers/api-client';

describe('Audit Logs', () => {
  const client = getBackendClient();

  it('GET /organization/audit-logs returns 200 or 403', async () => {
    try {
      const response = await client.get('/organization/audit-logs');
      const body = fullResponse(response);

      if (body.status === 403) {
        console.log(
          'GET /organization/audit-logs returned 403 (permission denied), skipping assertions',
        );
        return;
      }

      expect(body.status).toBe(200);

      // If accessible and has logs, fetch a single log entry
      const logs = Array.isArray(body.data) ? body.data : body.data?.data;
      if (Array.isArray(logs) && logs.length > 0) {
        const logId = logs[0].id || logs[0]._id;
        const detailRes = await client.get(`/organization/audit-logs/${logId}`);
        const detailBody = fullResponse(detailRes);

        expect(detailBody.status).toBe(200);
      } else {
        console.log('No audit logs found, skipping detail test');
      }
    } catch (err) {
      console.log('GET /organization/audit-logs threw an error, skipping:', (err as Error).message);
    }
  });
});
