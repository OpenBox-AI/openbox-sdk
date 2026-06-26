import { describe, it, expect } from 'vitest';
import { BACKEND_ENDPOINT_MANIFEST } from '../../ts/src/client/generated/endpoint-manifest.js';
import { getBackendClient, fullResponse, getOrgId, unwrap } from '../helpers/api-client';
import { GOVERNANCE_BOUNDARY_DOMAINS } from '../helpers/boundary-conformance';

function backendOperation(operationId: string) {
  const operation = BACKEND_ENDPOINT_MANIFEST.find((entry) => entry.operationId === operationId);
  expect(operation, operationId).toBeDefined();
  return operation!;
}

function expectValidation(body: any, fields: string[]) {
  expect(body.status).toBe(422);
  const message = JSON.stringify(body);
  for (const field of fields) {
    expect(message).toContain(field);
  }
}

function requiredFields(modelName: string): string[] {
  return GOVERNANCE_BOUNDARY_DOMAINS.requiredBodyFields
    .filter((entry) => entry.modelName === modelName)
    .map((entry) => entry.fieldName);
}

function withoutField(body: Record<string, unknown>, field: string): Record<string, unknown> {
  const copy = { ...body };
  delete copy[field];
  return copy;
}

describe('Auth Endpoints', () => {
  it('CONFORMANCE: GET /auth/profile returns API-key profile identity', async () => {
    // CONFORMANCE_PROOF: auth profile follows the generated operation and
    // asserts the local-stack API-key principal shape.
    const operation = backendOperation('AuthController_getProfile');
    const client = getBackendClient();
    const response = await client.get(operation.path);
    const body = fullResponse(response);

    expect(operation.path).toBe('/auth/profile');
    expect(body.status).toBe(200);

    const profile = body.data;
    expect(profile).toHaveProperty('sub');
    expect(profile).toHaveProperty('orgId');
    expect(profile).toHaveProperty('permissions');
    expect(Array.isArray(profile.permissions)).toBe(true);
    // X-API-Key auth surfaces a synthetic principal: sub starts with
    // `api-key:`, isApiKeyAuth is true, no email. JWT auth surfaces a
    // human user: sub is a UUID, email is set, isApiKeyAuth is absent.
    // SDK e2e dogfoods X-API-Key (mobile is the only sanctioned JWT
    // consumer) so assert the api-key shape here.
    expect(profile.sub).toMatch(/^api-key:/);
    expect(profile.isApiKeyAuth).toBe(true);
  });

  it('CONTRACT_BOUNDARY: auth DTOs reject every missing required field from TypeSpec', async () => {
    // CONTRACT_BOUNDARY_PROOF: local-stack auth/session operations are not
    // mutated by SDK X-API-Key transport, but every required TypeSpec DTO
    // field is sent through backend validation as a one-missing-field matrix.
    const client = getBackendClient();
    const loginOperation = backendOperation('AuthController_login');
    const logoutOperation = backendOperation('AuthController_logout');
    const forgotPasswordOperation = backendOperation('AuthController_forgotPassword');
    const resetPasswordOperation = backendOperation('AuthController_resetPassword');
    const changePasswordOperation = backendOperation('AuthController_changePassword');
    const refreshOperation = backendOperation('AuthController_refreshToken');
    expect([
      loginOperation.verb,
      logoutOperation.verb,
      forgotPasswordOperation.verb,
      resetPasswordOperation.verb,
      changePasswordOperation.verb,
      refreshOperation.verb,
    ]).toEqual(['post', 'post', 'post', 'post', 'post', 'post']);

    const loginBody = {
      realm: 'openbox',
      username: 'boundary@example.invalid',
      password: 'invalid-password',
      recaptchaToken: 'invalid-recaptcha',
    };
    for (const field of requiredFields('LoginDto')) {
      const response = await client.post(loginOperation.path, withoutField(loginBody, field));
      expectValidation(response.data, [field]);
    }

    const logoutBody = { refreshToken: 'invalid-refresh-token' };
    for (const field of requiredFields('LogoutDto')) {
      const response = await client.post(logoutOperation.path, withoutField(logoutBody, field));
      expectValidation(response.data, [field]);
    }

    const forgotPasswordBody = {
      email: 'boundary@example.invalid',
      realm: 'openbox',
    };
    for (const field of requiredFields('ForgotPasswordDto')) {
      const response = await client.post(forgotPasswordOperation.path, withoutField(forgotPasswordBody, field));
      expectValidation(response.data, [field]);
    }

    const resetPasswordBody = {
      token: 'invalid-reset-token',
      newPassword: 'InvalidPassword123!',
    };
    for (const field of requiredFields('ResetPasswordDto')) {
      const response = await client.post(resetPasswordOperation.path, withoutField(resetPasswordBody, field));
      expectValidation(response.data, [field]);
    }

    const changePasswordBody = {
      currentPassword: 'old-password',
      newPassword: 'InvalidPassword123!',
      orgId: getOrgId(),
    };
    for (const field of requiredFields('ChangePasswordDto')) {
      const response = await client.post(changePasswordOperation.path, withoutField(changePasswordBody, field));
      expectValidation(response.data, [field]);
    }

    const refreshBody = { refreshToken: 'invalid-refresh-token' };
    for (const field of requiredFields('RefreshDto')) {
      const response = await client.post(refreshOperation.path, withoutField(refreshBody, field));
      expectValidation(response.data, [field]);
    }
  });

  it('NEGATIVE: GET /user/roles requires read:user', async () => {
    // CONTRACT_BOUNDARY_PROOF: role listing fails closed for the SDK X-API-Key
    // principal; this is not a conditional status smoke test.
    const client = getBackendClient();
    const operation = backendOperation('UserController_getRoles');
    expect(operation.verb).toBe('get');
    const response = await client.get(operation.path);
    const body = response.data;

    expect(body.status).toBe(403);
    expect(body.message).toContain('read:user');
  });
});
