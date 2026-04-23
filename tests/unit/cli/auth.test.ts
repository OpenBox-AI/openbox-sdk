import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerAuthCommands } from '../../../packages/cli/src/commands/auth';
import { createMockClient, createTestProgram } from '../../helpers/cli';

vi.mock('../../../packages/cli/src/config', () => ({ getClient: vi.fn(), saveTokens: vi.fn() }));
vi.mock('../../../packages/cli/src/output', () => ({ output: vi.fn(), outputList: vi.fn() }));

import { getClient, saveTokens } from '../../../packages/cli/src/config';
import { output } from '../../../packages/cli/src/output';

describe('auth commands', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(getClient).mockReturnValue(mockClient as any);
  });

  it('profile calls getProfile()', async () => {
    const program = createTestProgram();
    registerAuthCommands(program);
    await program.parseAsync(['node', 'openbox', 'auth', 'profile']);
    expect(mockClient.getProfile).toHaveBeenCalled();
    expect(output).toHaveBeenCalled();
  });

  it('set-token calls saveTokens', async () => {
    const program = createTestProgram();
    registerAuthCommands(program);
    await program.parseAsync(['node', 'openbox', 'auth', 'set-token', 'my-token', 'my-refresh']);
    expect(saveTokens).toHaveBeenCalledWith('production', 'my-token', 'my-refresh');
  });

  // `openbox auth refresh` currently short-circuits with a "disabled" notice
  // (upstream /auth/refresh is broken; see client.ts:REFRESH_ENABLED).
  // Restore this test to its original form once the upstream fixes land.
  it.skip('refresh calls refreshTokens()', async () => {
    const program = createTestProgram();
    registerAuthCommands(program);
    await program.parseAsync(['node', 'openbox', 'auth', 'refresh']);
    expect(mockClient.refreshTokens).toHaveBeenCalled();
  });

  it('change-password calls changePassword()', async () => {
    const program = createTestProgram();
    registerAuthCommands(program);
    await program.parseAsync([
      'node',
      'openbox',
      'auth',
      'change-password',
      '--current',
      'old',
      '--new',
      'new',
      '--org-id',
      'org1',
    ]);
    expect(mockClient.changePassword).toHaveBeenCalledWith({
      currentPassword: 'old',
      newPassword: 'new',
      orgId: 'org1',
    });
  });

  it('roles calls getUserRoles()', async () => {
    const program = createTestProgram();
    registerAuthCommands(program);
    await program.parseAsync(['node', 'openbox', 'auth', 'roles']);
    expect(mockClient.getUserRoles).toHaveBeenCalled();
  });
});
