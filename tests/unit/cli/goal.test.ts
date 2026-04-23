import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerGoalCommands } from '../../../packages/cli/src/commands/goal';
import { createMockClient, createTestProgram } from '../../helpers/cli';

vi.mock('../../../packages/cli/src/config', () => ({ getClient: vi.fn() }));
vi.mock('../../../packages/cli/src/output', () => ({ output: vi.fn(), outputList: vi.fn() }));

import { getClient } from '../../../packages/cli/src/config';

describe('goal commands', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(getClient).mockReturnValue(mockClient as any);
  });

  it('update calls updateGoalAlignment', async () => {
    const program = createTestProgram();
    registerGoalCommands(program);
    await program.parseAsync([
      'node',
      'openbox',
      'goal',
      'update',
      'agent-1',
      '--threshold',
      '80',
      '--action',
      'alert_only',
    ]);
    expect(mockClient.updateGoalAlignment).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({ alignment_threshold: 80 }),
    );
  });

  it('trend calls getGoalAlignmentTrend', async () => {
    const program = createTestProgram();
    registerGoalCommands(program);
    await program.parseAsync(['node', 'openbox', 'goal', 'trend', 'agent-1']);
    expect(mockClient.getGoalAlignmentTrend).toHaveBeenCalled();
  });

  it('drifts calls getGoalAlignmentRecentDrifts', async () => {
    const program = createTestProgram();
    registerGoalCommands(program);
    await program.parseAsync(['node', 'openbox', 'goal', 'drifts', 'agent-1']);
    expect(mockClient.getGoalAlignmentRecentDrifts).toHaveBeenCalledWith('agent-1', 10);
  });
});
