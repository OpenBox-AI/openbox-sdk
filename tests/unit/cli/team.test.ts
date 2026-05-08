import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerTeamCommands } from '../../../ts/src/cli/commands/team';
import { createMockClient, createTestProgram } from '../../helpers/cli';

vi.mock('../../../ts/src/cli/config', () => ({ getClient: vi.fn() }));
vi.mock('../../../ts/src/cli/output', () => ({
  output: vi.fn(), outputList: vi.fn(),
  error: vi.fn(), warn: vi.fn(), note: vi.fn(), banner: vi.fn(),
  info: vi.fn(), action: vi.fn(), success: vi.fn(),
  row: vi.fn(), summary: vi.fn(), kv: vi.fn(), table: vi.fn(),
}));

import { getClient } from '../../../ts/src/cli/config';

describe('team commands', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(getClient).mockReturnValue(mockClient as any);
  });

  it('list calls listTeams', async () => {
    const program = createTestProgram();
    registerTeamCommands(program);
    await program.parseAsync(['node', 'openbox', 'team', 'list', 'org-1']);
    expect(mockClient.listTeams).toHaveBeenCalledWith('org-1', expect.anything());
  });

  it('stats calls getTeamStats', async () => {
    const program = createTestProgram();
    registerTeamCommands(program);
    await program.parseAsync(['node', 'openbox', 'team', 'stats', 'org-1']);
    expect(mockClient.getTeamStats).toHaveBeenCalledWith('org-1');
  });

  it('get calls getTeam', async () => {
    const program = createTestProgram();
    registerTeamCommands(program);
    await program.parseAsync(['node', 'openbox', 'team', 'get', 'org-1', 'team-1']);
    expect(mockClient.getTeam).toHaveBeenCalledWith('org-1', 'team-1');
  });

  it('create posts { name, description, icon } from flags', async () => {
    const program = createTestProgram();
    registerTeamCommands(program);
    await program.parseAsync([
      'node', 'openbox', 'team', 'create', 'org-1',
      '--name', 'Finance',
      '--desc', 'money folks',
      '--icon', 'https://example.com/f.png',
    ]);
    expect(mockClient.createTeam).toHaveBeenCalledWith('org-1', {
      name: 'Finance',
      description: 'money folks',
      icon: 'https://example.com/f.png',
    });
  });

  it('create rejects when neither --name nor --icon is given', async () => {
    const program = createTestProgram();
    registerTeamCommands(program);
    await expect(
      program.parseAsync(['node', 'openbox', 'team', 'create', 'org-1']),
    ).rejects.toThrow();
    expect(mockClient.createTeam).not.toHaveBeenCalled();
  });

  it('create passes through --json body as-is', async () => {
    const program = createTestProgram();
    registerTeamCommands(program);
    await program.parseAsync([
      'node', 'openbox', 'team', 'create', 'org-1',
      '--body', '{"name":"Legal","custom_field":true}',
    ]);
    expect(mockClient.createTeam).toHaveBeenCalledWith('org-1', {
      name: 'Legal',
      custom_field: true,
    });
  });

  it('update calls updateTeam', async () => {
    const program = createTestProgram();
    registerTeamCommands(program);
    await program.parseAsync([
      'node', 'openbox', 'team', 'update', 'org-1', 'team-1',
      '-n', 'NewTeam',
    ]);
    expect(mockClient.updateTeam).toHaveBeenCalledWith(
      'org-1',
      'team-1',
      expect.objectContaining({ name: 'NewTeam' }),
    );
  });

  it('delete accepts variadic --ids and posts { ids: [...] }', async () => {
    const program = createTestProgram();
    registerTeamCommands(program);
    await program.parseAsync([
      'node', 'openbox', 'team', 'delete', 'org-1',
      '--ids', 't-1', 't-2', 't-3',
    ]);
    expect(mockClient.deleteTeams).toHaveBeenCalledWith('org-1', { ids: ['t-1', 't-2', 't-3'] });
  });

  it('delete rejects when --ids is omitted', async () => {
    const program = createTestProgram();
    registerTeamCommands(program);
    await expect(
      program.parseAsync(['node', 'openbox', 'team', 'delete', 'org-1']),
    ).rejects.toThrow();
  });

  it('members calls getTeamMembers', async () => {
    const program = createTestProgram();
    registerTeamCommands(program);
    await program.parseAsync(['node', 'openbox', 'team', 'members', 'org-1', 'team-1']);
    expect(mockClient.getTeamMembers).toHaveBeenCalledWith('org-1', 'team-1', expect.anything());
  });

  it('add-members posts { user_ids: [...] }', async () => {
    const program = createTestProgram();
    registerTeamCommands(program);
    await program.parseAsync([
      'node', 'openbox', 'team', 'add-members', 'org-1', 'team-1',
      '--user-ids', 'u-a', 'u-b',
    ]);
    expect(mockClient.addTeamMembers).toHaveBeenCalledWith('org-1', 'team-1', { user_ids: ['u-a', 'u-b'] });
  });

  it('remove-members hits the separate client method', async () => {
    const program = createTestProgram();
    registerTeamCommands(program);
    await program.parseAsync([
      'node', 'openbox', 'team', 'remove-members', 'org-1', 'team-1',
      '--user-ids', 'u-a',
    ]);
    expect(mockClient.removeTeamMembers).toHaveBeenCalled();
    expect(mockClient.addTeamMembers).not.toHaveBeenCalled();
  });
});
