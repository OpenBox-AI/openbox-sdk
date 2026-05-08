import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerMemberCommands } from '../../../ts/src/cli/commands/member';
import { createMockClient, createTestProgram } from '../../helpers/cli';

vi.mock('../../../ts/src/cli/config', () => ({ getClient: vi.fn() }));
vi.mock('../../../ts/src/cli/output', () => ({
  output: vi.fn(), outputList: vi.fn(),
  error: vi.fn(), warn: vi.fn(), note: vi.fn(), banner: vi.fn(),
  info: vi.fn(), action: vi.fn(), success: vi.fn(),
  row: vi.fn(), summary: vi.fn(), kv: vi.fn(), table: vi.fn(),
}));

import { getClient } from '../../../ts/src/cli/config';

describe('member commands', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(getClient).mockReturnValue(mockClient as any);
  });

  it('list calls listMembers', async () => {
    const program = createTestProgram();
    registerMemberCommands(program);
    await program.parseAsync(['node', 'openbox', 'member', 'list', 'org-1']);
    expect(mockClient.listMembers).toHaveBeenCalledWith('org-1', expect.anything());
  });

  it('invite requires --roles', async () => {
    const program = createTestProgram();
    registerMemberCommands(program);
    await expect(
      program.parseAsync([
        'node', 'openbox', 'member', 'invite', 'org-1',
        '--email', 'a@b.com',
      ]),
    ).rejects.toThrow();
    expect(mockClient.inviteUser).not.toHaveBeenCalled();
  });

  it('invite posts { email, roles } with the right shape', async () => {
    const program = createTestProgram();
    registerMemberCommands(program);
    await program.parseAsync([
      'node', 'openbox', 'member', 'invite', 'org-1',
      '--email', 'a@b.com',
      '--roles', 'Developer', 'Auditor',
    ]);
    expect(mockClient.inviteUser).toHaveBeenCalledWith('org-1', {
      email: 'a@b.com',
      roles: ['Developer', 'Auditor'],
    });
  });

  it('create requires --username + --email', async () => {
    const program = createTestProgram();
    registerMemberCommands(program);
    await expect(
      program.parseAsync(['node', 'openbox', 'member', 'create', 'org-1']),
    ).rejects.toThrow();
  });

  it('create posts the canonical createUser DTO (Keycloak casing)', async () => {
    const program = createTestProgram();
    registerMemberCommands(program);
    await program.parseAsync([
      'node', 'openbox', 'member', 'create', 'org-1',
      '--username', 'alice',
      '--email', 'alice@ex.com',
      '--first-name', 'Alice',
      '--last-name', 'Liddell',
      '--verified',
    ]);
    expect(mockClient.createUser).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        username: 'alice',
        email: 'alice@ex.com',
        firstName: 'Alice',
        lastName: 'Liddell',
        emailVerified: true,
        roles: [],
      }),
    );
  });

  it('update posts { role, team_ids }', async () => {
    const program = createTestProgram();
    registerMemberCommands(program);
    await program.parseAsync([
      'node', 'openbox', 'member', 'update', 'org-1', 'user-1',
      '--role', 'Auditor',
      '--teams', 't-a', 't-b',
    ]);
    expect(mockClient.updateMember).toHaveBeenCalledWith('org-1', 'user-1', {
      role: 'Auditor',
      team_ids: ['t-a', 't-b'],
    });
  });

  it('assign-roles passes through role-name array', async () => {
    const program = createTestProgram();
    registerMemberCommands(program);
    await program.parseAsync([
      'node', 'openbox', 'member', 'assign-roles', 'org-1', 'user-1',
      '--roles', 'Developer', 'Auditor',
    ]);
    expect(mockClient.assignRoles).toHaveBeenCalledWith('org-1', 'user-1', ['Developer', 'Auditor']);
  });

  it('remove-roles hits a separate client method, not assign-roles', async () => {
    const program = createTestProgram();
    registerMemberCommands(program);
    await program.parseAsync([
      'node', 'openbox', 'member', 'remove-roles', 'org-1', 'user-1',
      '--roles', 'Developer',
    ]);
    expect(mockClient.removeRoles).toHaveBeenCalledWith('org-1', 'user-1', ['Developer']);
    expect(mockClient.assignRoles).not.toHaveBeenCalled();
  });

  it('remove posts variadic ids', async () => {
    const program = createTestProgram();
    registerMemberCommands(program);
    await program.parseAsync([
      'node', 'openbox', 'member', 'remove', 'org-1',
      '--ids', 'u-1', 'u-2',
    ]);
    expect(mockClient.removeMembers).toHaveBeenCalledWith('org-1', ['u-1', 'u-2']);
  });
});
