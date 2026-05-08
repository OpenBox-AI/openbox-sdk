import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerApiKeyCommands } from '../../../ts/src/cli/commands/api-key';
import { createMockClient, createTestProgram } from '../../helpers/cli';

vi.mock('../../../ts/src/cli/config', () => ({ getClient: vi.fn() }));
vi.mock('../../../ts/src/cli/output', () => ({
  output: vi.fn(), outputList: vi.fn(),
  error: vi.fn(), warn: vi.fn(), note: vi.fn(), banner: vi.fn(),
  info: vi.fn(), action: vi.fn(), success: vi.fn(),
  row: vi.fn(), summary: vi.fn(), kv: vi.fn(), table: vi.fn(),
}));

import { getClient } from '../../../ts/src/cli/config';
import { output } from '../../../ts/src/cli/output';

describe('api-key commands', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(getClient).mockReturnValue(mockClient as any);
  });

  it('rotate calls rotateApiKey(agentId)', async () => {
    const program = createTestProgram();
    registerApiKeyCommands(program);
    await program.parseAsync(['node', 'openbox', 'api-key', 'rotate', 'agent-1']);
    expect(mockClient.rotateApiKey).toHaveBeenCalledWith('agent-1');
    expect(output).toHaveBeenCalled();
  });

  it('rotate requires an agentId', async () => {
    const program = createTestProgram();
    registerApiKeyCommands(program);
    await expect(
      program.parseAsync(['node', 'openbox', 'api-key', 'rotate']),
    ).rejects.toThrow();
    expect(mockClient.rotateApiKey).not.toHaveBeenCalled();
  });

  it('revoke calls revokeApiKey(agentId)', async () => {
    const program = createTestProgram();
    registerApiKeyCommands(program);
    await program.parseAsync(['node', 'openbox', 'api-key', 'revoke', 'agent-1']);
    expect(mockClient.revokeApiKey).toHaveBeenCalledWith('agent-1');
    expect(output).toHaveBeenCalled();
  });

  it('revoke does not call rotate by mistake', async () => {
    const program = createTestProgram();
    registerApiKeyCommands(program);
    await program.parseAsync(['node', 'openbox', 'api-key', 'revoke', 'agent-1']);
    expect(mockClient.rotateApiKey).not.toHaveBeenCalled();
  });
});
