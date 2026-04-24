// Unit tests for destructive member commands: invite / create / update /
// remove / assign-roles / remove-roles.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { makeMockClient, type MockClient } from '../helpers/mock-client.js';

const mockClient: MockClient = makeMockClient();

vi.mock('../../src/config.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../src/config.js',
  );
  return { ...actual, getClient: () => mockClient };
});

import { registerMemberCommands } from '../../src/commands/member.js';

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerMemberCommands(program);
  return program;
}

beforeEach(() => {
  mockClient.__calls.length = 0;
  mockClient.__responses.inviteUser = { ok: true };
  mockClient.__responses.createUser = { id: 'u-1' };
  mockClient.__responses.updateMember = { ok: true };
  mockClient.__responses.removeMembers = { ok: true };
  mockClient.__responses.assignRoles = { ok: true };
  mockClient.__responses.removeRoles = { ok: true };
});

describe('member invite', () => {
  it('requires --roles (backend ArrayNotEmpty)', async () => {
    await expect(
      makeProgram().parseAsync([
        'node',
        'openbox',
        'member',
        'invite',
        'org-1',
        '--email',
        'a@b.com',
      ]),
    ).rejects.toThrow();
    expect(mockClient.__calls).toHaveLength(0);
  });

  it('posts { email, roles } with the right shape', async () => {
    await makeProgram().parseAsync([
      'node',
      'openbox',
      'member',
      'invite',
      'org-1',
      '--email',
      'a@b.com',
      '--roles',
      'Developer',
      'Auditor',
    ]);
    expect(mockClient.__calls[0].method).toBe('inviteUser');
    expect(mockClient.__calls[0].args[1]).toEqual({
      email: 'a@b.com',
      roles: ['Developer', 'Auditor'],
    });
  });
});

describe('member create', () => {
  it('requires --username + --email', async () => {
    await expect(
      makeProgram().parseAsync(['node', 'openbox', 'member', 'create', 'org-1']),
    ).rejects.toThrow();
  });

  it('posts the canonical createUser DTO (Keycloak casing)', async () => {
    await makeProgram().parseAsync([
      'node',
      'openbox',
      'member',
      'create',
      'org-1',
      '--username',
      'alice',
      '--email',
      'alice@ex.com',
      '--first-name',
      'Alice',
      '--last-name',
      'Liddell',
      '--verified',
    ]);
    expect(mockClient.__calls[0].method).toBe('createUser');
    expect(mockClient.__calls[0].args[1]).toMatchObject({
      username: 'alice',
      email: 'alice@ex.com',
      firstName: 'Alice',
      lastName: 'Liddell',
      emailVerified: true,
      roles: [],
    });
  });
});

describe('member update / remove / assign-roles / remove-roles', () => {
  it('update posts { role, team_ids }', async () => {
    await makeProgram().parseAsync([
      'node',
      'openbox',
      'member',
      'update',
      'org-1',
      'user-1',
      '--role',
      'Auditor',
      '--teams',
      't-a',
      't-b',
    ]);
    expect(mockClient.__calls[0].method).toBe('updateMember');
    expect(mockClient.__calls[0].args[2]).toEqual({
      role: 'Auditor',
      team_ids: ['t-a', 't-b'],
    });
  });

  it('remove posts variadic ids', async () => {
    await makeProgram().parseAsync([
      'node',
      'openbox',
      'member',
      'remove',
      'org-1',
      '--ids',
      'u-1',
      'u-2',
    ]);
    expect(mockClient.__calls[0].method).toBe('removeMembers');
    expect(mockClient.__calls[0].args[1]).toEqual(['u-1', 'u-2']);
  });

  it('assign-roles passes through role-name array', async () => {
    await makeProgram().parseAsync([
      'node',
      'openbox',
      'member',
      'assign-roles',
      'org-1',
      'user-1',
      '--roles',
      'Developer',
      'Auditor',
    ]);
    expect(mockClient.__calls[0].method).toBe('assignRoles');
    expect(mockClient.__calls[0].args[2]).toEqual(['Developer', 'Auditor']);
  });

  it('remove-roles hits a separate client method, not assign-roles', async () => {
    await makeProgram().parseAsync([
      'node',
      'openbox',
      'member',
      'remove-roles',
      'org-1',
      'user-1',
      '--roles',
      'Developer',
    ]);
    expect(mockClient.__calls[0].method).toBe('removeRoles');
  });
});
