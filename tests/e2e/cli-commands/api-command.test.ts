import { describe, expect, it } from 'vitest';
import { getOrgId } from '../../helpers/api-client';
import { runCli } from '../helpers/cli-runner';
import { CAN_RUN_CLI } from './can-run';

const describeOrSkip = CAN_RUN_CLI ? describe : describe.skip;

function parseStdout<T = unknown>(stdout: string): T {
  return JSON.parse(stdout) as T;
}

describeOrSkip('api command (e2e, real backend/core)', () => {
  it('lists generated backend operations', () => {
    const res = runCli(['api', 'list', 'backend']);

    expect(res.status).toBe(0);
    expect(res.stderr).toBe('');
    const operations = parseStdout<Array<{ operationId: string }>>(res.stdout);
    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operationId: 'AuthController_getProfile' }),
        expect.objectContaining({ operationId: 'OrganizationController_getOrganization' }),
      ]),
    );
  });

  it('calls a generated backend operation without path params', () => {
    const res = runCli(['api', 'backend', 'AuthController_getProfile']);

    expect(res.status).toBe(0);
    expect(res.stderr).toBe('');
    const profile = parseStdout<{ orgId?: string }>(res.stdout);
    expect(profile.orgId).toBe(getOrgId());
  });

  it('calls a generated backend operation with path params and query', () => {
    const orgId = getOrgId();
    const res = runCli([
      'api',
      'backend',
      'OrganizationController_getTeams',
      '--params',
      JSON.stringify({ organizationId: orgId }),
      '--query',
      JSON.stringify({ limit: 5 }),
    ]);

    expect(res.status).toBe(0);
    expect(res.stderr).toBe('');
    const body = parseStdout(res.stdout);
    expect(body).toBeDefined();
  });

  it('calls a generated core operation', () => {
    const res = runCli(['api', 'core', 'healthCheck']);

    expect(res.status).toBe(0);
    expect(res.stderr).toBe('');
    expect(parseStdout(res.stdout)).toBe('hello world');
  });

  it('rejects unknown operation IDs', () => {
    const res = runCli(['api', 'backend', 'NoSuchOperation']);

    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('unknown backend operationId: NoSuchOperation');
  });
});
