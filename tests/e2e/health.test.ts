import { describe, it, expect } from 'vitest';
import { getBackendClient, getCoreClient, fullResponse } from '../helpers/api-client';

describe('Health Endpoints', () => {
  it('GET /health returns status 200 with "Success"', async () => {
    const client = getBackendClient();
    const response = await client.get('/health');
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toBe('Success');
  });

  it('GET core.openbox.ai/ returns "hello world"', async () => {
    const coreClient = getCoreClient();
    const response = await coreClient.get('/');

    expect(response.status).toBe(200);
    expect(response.data).toBe('hello world');
  });
});
