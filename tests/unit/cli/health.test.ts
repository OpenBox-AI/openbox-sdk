import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerHealthCommands } from '../../../ts/src/cli/commands/health';
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
