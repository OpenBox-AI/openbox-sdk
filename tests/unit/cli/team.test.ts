import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerTeamCommands } from '../../../ts/src/cli/commands/team';
import { createMockClient, createTestProgram } from '../../helpers/cli';

vi.mock('../../../ts/src/cli/config', () => ({ getClient: vi.fn() }));
vi.mock('../../../ts/src/cli/output', () => ({ output: vi.fn(), outputList: vi.fn() }));

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

  it('update calls updateTeam', async () => {
    const program = createTestProgram();
    registerTeamCommands(program);
    await program.parseAsync([
      'node',
      'openbox',
      'team',
      'update',
      'org-1',
      'team-1',
      '-n',
      'NewTeam',
    ]);
    expect(mockClient.updateTeam).toHaveBeenCalledWith(
      'org-1',
      'team-1',
      expect.objectContaining({ name: 'NewTeam' }),
    );
  });

  it('members calls getTeamMembers', async () => {
    const program = createTestProgram();
    registerTeamCommands(program);
    await program.parseAsync(['node', 'openbox', 'team', 'members', 'org-1', 'team-1']);
    expect(mockClient.getTeamMembers).toHaveBeenCalledWith('org-1', 'team-1', expect.anything());
  });
});
