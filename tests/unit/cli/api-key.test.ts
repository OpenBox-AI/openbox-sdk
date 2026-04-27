import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerApiKeyCommands } from '../../../ts/cli/src/commands/api-key';
import { createMockClient, createTestProgram } from '../../helpers/cli';

vi.mock('../../../ts/cli/src/config', () => ({ getClient: vi.fn() }));
vi.mock('../../../ts/cli/src/output', () => ({ output: vi.fn(), outputList: vi.fn() }));

import { getClient } from '../../../ts/cli/src/config';
import { output } from '../../../ts/cli/src/output';

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

  it('revoke calls revokeApiKey(agentId)', async () => {
    const program = createTestProgram();
    registerApiKeyCommands(program);
    await program.parseAsync(['node', 'openbox', 'api-key', 'revoke', 'agent-1']);
    expect(mockClient.revokeApiKey).toHaveBeenCalledWith('agent-1');
    expect(output).toHaveBeenCalled();
  });
});
