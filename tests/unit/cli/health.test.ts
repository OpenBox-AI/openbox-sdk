import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerHealthCommands } from '../../../packages/cli/src/commands/health';
import { createMockClient, createTestProgram } from '../../helpers/cli';

vi.mock('../../../packages/cli/src/config', () => ({ getClient: vi.fn() }));
vi.mock('../../../packages/cli/src/output', () => ({ output: vi.fn(), outputList: vi.fn() }));

import { getClient } from '../../../packages/cli/src/config';
import { output } from '../../../packages/cli/src/output';

describe('health command', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(getClient).mockReturnValue(mockClient as any);
  });

  it('calls health()', async () => {
    const program = createTestProgram();
    registerHealthCommands(program);
    await program.parseAsync(['node', 'openbox', 'health']);
    expect(mockClient.health).toHaveBeenCalled();
    expect(output).toHaveBeenCalled();
  });
});
