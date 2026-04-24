// Unit tests for `auth logout` - the one auth command that does destructive
// work (server-side session revoke + local token wipe). We stub both the
// client and the hasTokens/clearTokens helpers since the action branches on
// local-tokens state.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { makeMockClient, type MockClient } from '../helpers/mock-client.js';

const mockClient: MockClient = makeMockClient();
const state = {
  tokensForEnv: new Set<string>(),
  clearedEnvs: [] as string[],
};

vi.mock('../../src/config.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../src/config.js',
  );
  return {
    ...actual,
    getClient: () => mockClient,
    hasTokens: (env: string) => state.tokensForEnv.has(env),
    clearTokens: (env: string) => {
      state.clearedEnvs.push(env);
      state.tokensForEnv.delete(env);
      return true;
    },
  };
});

// Keep OPENBOX_ENV stable across tests so `resolveEnv()` returns a known value.
beforeEach(() => {
  mockClient.__calls.length = 0;
  state.tokensForEnv = new Set();
  state.clearedEnvs = [];
  mockClient.__responses.logout = undefined; // successful logout resolves void
  process.env.OPENBOX_ENV = 'production';
});

import { registerAuthCommands } from '../../src/commands/auth.js';

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerAuthCommands(program);
  return program;
}

describe('auth logout', () => {
  it('no-ops when the current env has no local tokens', async () => {
    await makeProgram().parseAsync(['node', 'openbox', 'auth', 'logout']);
    expect(mockClient.__calls).toHaveLength(0);
    expect(state.clearedEnvs).toHaveLength(0);
  });

  it('revokes server session + clears local tokens when present', async () => {
    state.tokensForEnv.add('production');
    await makeProgram().parseAsync(['node', 'openbox', 'auth', 'logout']);
    expect(mockClient.__calls).toHaveLength(1);
    expect(mockClient.__calls[0].method).toBe('logout');
    expect(state.clearedEnvs).toEqual(['production']);
  });

  it('still clears local tokens if server revoke fails (best-effort)', async () => {
    state.tokensForEnv.add('production');
    mockClient.__responses.logout = Promise.reject(new Error('401 expired'));
    await makeProgram().parseAsync(['node', 'openbox', 'auth', 'logout']);
    // Server call attempted, failed; local cleanup still ran.
    expect(state.clearedEnvs).toEqual(['production']);
  });

  it('--all iterates both envs; skips ones without local tokens', async () => {
    state.tokensForEnv.add('production');
    // staging has no tokens → skip (don't attempt server revoke, don't error)
    await makeProgram().parseAsync(['node', 'openbox', 'auth', 'logout', '--all']);
    expect(state.clearedEnvs).toEqual(['production']);
    // logout() called once (for prod only)
    expect(mockClient.__calls.filter((c) => c.method === 'logout')).toHaveLength(1);
  });

  it('--all clears both envs when both have tokens', async () => {
    state.tokensForEnv.add('production');
    state.tokensForEnv.add('staging');
    await makeProgram().parseAsync(['node', 'openbox', 'auth', 'logout', '--all']);
    expect(state.clearedEnvs.sort()).toEqual(['production', 'staging']);
  });
});
