// Unit tests for `auth logout` - the one auth command that does destructive
// work (server-side session revoke + local token wipe). Stubs both the client
// and the hasTokens/clearTokens helpers since the action branches on
// local-tokens state.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockClient, createTestProgram } from '../../helpers/cli';

const state = {
  tokensForEnv: new Set<string>(),
  clearedEnvs: [] as string[],
};

vi.mock('../../../ts/src/cli/config', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../../ts/src/cli/config');
  return {
    ...actual,
    getClient: vi.fn(),
    hasTokens: (env: string) => state.tokensForEnv.has(env),
    clearTokens: (env: string) => {
      state.clearedEnvs.push(env);
      state.tokensForEnv.delete(env);
      return true;
    },
  };
});
vi.mock('../../../ts/src/cli/output', () => ({ output: vi.fn(), outputList: vi.fn() }));

import { getClient } from '../../../ts/src/cli/config';
import { registerAuthCommands } from '../../../ts/src/cli/commands/auth';

describe('auth logout', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(getClient).mockReturnValue(mockClient as any);
    state.tokensForEnv = new Set();
    state.clearedEnvs = [];
    process.env.OPENBOX_ENV = 'production';
  });

  it('no-ops when the current env has no local tokens', async () => {
    const program = createTestProgram();
    registerAuthCommands(program);
    await program.parseAsync(['node', 'openbox', 'auth', 'logout']);
    expect(mockClient.logout).not.toHaveBeenCalled();
    expect(state.clearedEnvs).toHaveLength(0);
  });

  it('revokes server session + clears local tokens when present', async () => {
    state.tokensForEnv.add('production');
    const program = createTestProgram();
    registerAuthCommands(program);
    await program.parseAsync(['node', 'openbox', 'auth', 'logout']);
    expect(mockClient.logout).toHaveBeenCalledTimes(1);
    expect(state.clearedEnvs).toEqual(['production']);
  });

  it('still clears local tokens if server revoke fails (best-effort)', async () => {
    state.tokensForEnv.add('production');
    mockClient.logout.mockRejectedValueOnce(new Error('401 expired'));
    const program = createTestProgram();
    registerAuthCommands(program);
    await program.parseAsync(['node', 'openbox', 'auth', 'logout']);
    expect(state.clearedEnvs).toEqual(['production']);
  });

  it('--all iterates both envs; skips ones without local tokens', async () => {
    state.tokensForEnv.add('production');
    const program = createTestProgram();
    registerAuthCommands(program);
    await program.parseAsync(['node', 'openbox', 'auth', 'logout', '--all']);
    expect(state.clearedEnvs).toEqual(['production']);
    expect(mockClient.logout).toHaveBeenCalledTimes(1);
  });

  it('--all clears both envs when both have tokens', async () => {
    state.tokensForEnv.add('production');
    state.tokensForEnv.add('staging');
    const program = createTestProgram();
    registerAuthCommands(program);
    await program.parseAsync(['node', 'openbox', 'auth', 'logout', '--all']);
    expect(state.clearedEnvs.sort()).toEqual(['production', 'staging']);
  });
});
