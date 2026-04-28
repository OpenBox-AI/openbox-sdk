import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerMemberCommands } from '../../../ts/src/cli/commands/member';
import { createMockClient, createTestProgram } from '../../helpers/cli';

vi.mock('../../../ts/src/cli/config', () => ({ getClient: vi.fn() }));
vi.mock('../../../ts/src/cli/output', () => ({ output: vi.fn(), outputList: vi.fn() }));

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

  it('create calls createUser', async () => {
    const program = createTestProgram();
    registerMemberCommands(program);
    await program.parseAsync([
      'node',
      'openbox',
      'member',
      'create',
      'org-1',
      '--username',
      'john',
      '--email',
      'j@t.com',
      '--password',
      'pass',
    ]);
    expect(mockClient.createUser).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ username: 'john', email: 'j@t.com' }),
    );
  });

  it('update calls updateMember', async () => {
    const program = createTestProgram();
    registerMemberCommands(program);
    await program.parseAsync([
      'node',
      'openbox',
      'member',
      'update',
      'org-1',
      'user-1',
      '--role',
      'admin',
    ]);
    expect(mockClient.updateMember).toHaveBeenCalledWith('org-1', 'user-1', expect.anything());
  });

  it('assign-roles calls assignRoles', async () => {
    const program = createTestProgram();
    registerMemberCommands(program);
    await program.parseAsync([
      'node',
      'openbox',
      'member',
      'assign-roles',
      'org-1',
      'user-1',
      '--roles',
      'admin',
      'viewer',
    ]);
    expect(mockClient.assignRoles).toHaveBeenCalledWith('org-1', 'user-1', ['admin', 'viewer']);
  });

  it('remove-roles calls removeRoles', async () => {
    const program = createTestProgram();
    registerMemberCommands(program);
    await program.parseAsync([
      'node',
      'openbox',
      'member',
      'remove-roles',
      'org-1',
      'user-1',
      '--roles',
      'admin',
    ]);
    expect(mockClient.removeRoles).toHaveBeenCalledWith('org-1', 'user-1', ['admin']);
  });

  it('remove calls removeMembers', async () => {
    const program = createTestProgram();
    registerMemberCommands(program);
    await program.parseAsync(['node', 'openbox', 'member', 'remove', 'org-1', '--ids', 'u1', 'u2']);
    expect(mockClient.removeMembers).toHaveBeenCalledWith('org-1', ['u1', 'u2']);
  });

  it('invite calls inviteUser', async () => {
    const program = createTestProgram();
    registerMemberCommands(program);
    await program.parseAsync([
      'node',
      'openbox',
      'member',
      'invite',
      'org-1',
      '--email',
      'new@t.com',
      '--roles',
      'viewer',
    ]);
    expect(mockClient.inviteUser).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ email: 'new@t.com' }),
    );
  });
});
