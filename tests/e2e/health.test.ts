import { describe, it, expect } from 'vitest';
import { BACKEND_ENDPOINT_MANIFEST } from '../../ts/src/client/generated/endpoint-manifest.js';
import { getBackendClient, getCoreClient, fullResponse } from '../helpers/api-client';

function backendOperation(operationId: string) {
  const operation = BACKEND_ENDPOINT_MANIFEST.find((entry) => entry.operationId === operationId);
  expect(operation, operationId).toBeDefined();
  return operation!;
}

describe('Health Endpoints', () => {
  it('CONFORMANCE: GET /health returns generated backend health response', async () => {
    const client = getBackendClient();
    const operation = backendOperation('AppController_getHello');
    const response = await client.get(operation.path);
    const body = fullResponse(response);

    expect(operation.path).toBe('/health');
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
