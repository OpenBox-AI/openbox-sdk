import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerAuthCommands } from '../../../ts/src/cli/commands/auth';
import { createTestProgram } from '../../helpers/cli';

vi.mock('../../../ts/src/cli/config', () => ({
  saveApiKey: vi.fn(),
  clearApiKey: vi.fn(),
  loadApiKey: vi.fn(),
}));

import { saveApiKey, clearApiKey, loadApiKey } from '../../../ts/src/cli/config';

const VALID_KEY = 'obx_key_' + 'a'.repeat(48);

describe('auth commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('set-api-key with --key persists via saveApiKey using the resolved env', async () => {
    const { resolveEnv } = await import('../../../ts/src/env/index');
    const program = createTestProgram();
    registerAuthCommands(program);
    await program.parseAsync(['node', 'openbox', 'auth', 'set-api-key', '--key', VALID_KEY]);
    expect(saveApiKey).toHaveBeenCalledWith(resolveEnv(), VALID_KEY);
  });

  it('set-api-key rejects badly-shaped keys without persisting', async () => {
    const program = createTestProgram();
    registerAuthCommands(program);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as any);
    await expect(
      program.parseAsync(['node', 'openbox', 'auth', 'set-api-key', '--key', 'not-an-obx-key']),
    ).rejects.toThrow();
    expect(saveApiKey).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('clear-api-key calls clearApiKey for the resolved env', async () => {
    const { resolveEnv } = await import('../../../ts/src/env/index');
    const program = createTestProgram();
    registerAuthCommands(program);
    await program.parseAsync(['node', 'openbox', 'auth', 'clear-api-key']);
    expect(clearApiKey).toHaveBeenCalledWith(resolveEnv());
  });

  it('status reads loadApiKey for the active env', async () => {
    vi.mocked(loadApiKey).mockReturnValue(undefined);
    const program = createTestProgram();
    registerAuthCommands(program);
    await program.parseAsync(['node', 'openbox', 'auth', 'status']);
    // Status now scopes to the active env only - no per-env enumeration.
    expect(loadApiKey).toHaveBeenCalledTimes(1);
  });
});
