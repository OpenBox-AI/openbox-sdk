import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerViolationCommands } from '../../../packages/cli/src/commands/violation';
import { createMockClient, createTestProgram } from '../../helpers/cli';

vi.mock('../../../packages/cli/src/config', () => ({ getClient: vi.fn() }));
vi.mock('../../../packages/cli/src/output', () => ({ output: vi.fn(), outputList: vi.fn() }));

import { getClient } from '../../../packages/cli/src/config';

describe('violation commands', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(getClient).mockReturnValue(mockClient as any);
  });

  it('list calls getAllViolations', async () => {
    const program = createTestProgram();
    registerViolationCommands(program);
    await program.parseAsync(['node', 'openbox', 'violation', 'list']);
    expect(mockClient.getAllViolations).toHaveBeenCalled();
  });

  it('agent calls getAgentViolations', async () => {
    const program = createTestProgram();
    registerViolationCommands(program);
    await program.parseAsync(['node', 'openbox', 'violation', 'agent', 'agent-1']);
    expect(mockClient.getAgentViolations).toHaveBeenCalledWith('agent-1', expect.anything());
  });

  it('false-positive calls markFalsePositive', async () => {
    const program = createTestProgram();
    registerViolationCommands(program);
    await program.parseAsync([
      'node',
      'openbox',
      'violation',
      'false-positive',
      'agent-1',
      'viol-1',
      'guardrail',
    ]);
    expect(mockClient.markFalsePositive).toHaveBeenCalledWith('agent-1', 'viol-1', 'guardrail');
  });
});
