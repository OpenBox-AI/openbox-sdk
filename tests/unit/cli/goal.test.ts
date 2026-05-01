import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerGoalCommands } from '../../../ts/src/cli/commands/goal';
import { createMockClient, createTestProgram } from '../../helpers/cli';

vi.mock('../../../ts/src/cli/config', () => ({ getClient: vi.fn() }));
vi.mock('../../../ts/src/cli/output', () => ({ output: vi.fn(), outputList: vi.fn() }));

import { getClient } from '../../../ts/src/cli/config';

describe('goal commands', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(getClient).mockReturnValue(mockClient as any);
  });

  const fullUpdate = [
    '--threshold', '80',
    '--action', 'alert_only',
    '--frequency', 'every_action',
    '--model', 'llama-firewall-v1',
  ];

  it('update sends all four fields with correct casing', async () => {
    const program = createTestProgram();
    registerGoalCommands(program);
    await program.parseAsync([
      'node', 'openbox', 'goal', 'update', 'agent-1', ...fullUpdate,
    ]);
    expect(mockClient.updateGoalAlignment).toHaveBeenCalledWith('agent-1', {
      alignment_threshold: 80,
      drift_detection_action: 'alert_only',
      evaluation_frequency: 'every_action',
      llama_firewall_model: 'llama-firewall-v1',
    });
  });

  it('update fails fast when any required field is missing', async () => {
    const program = createTestProgram();
    registerGoalCommands(program);
    const partial = [
      '--threshold', '80',
      '--action', 'alert_only',
      '--frequency', 'every_action',
      // --model omitted
    ];
    await expect(
      program.parseAsync(['node', 'openbox', 'goal', 'update', 'agent-1', ...partial]),
    ).rejects.toThrow();
    expect(mockClient.updateGoalAlignment).not.toHaveBeenCalled();
  });

  it('update rejects invalid --action enum', async () => {
    const program = createTestProgram();
    registerGoalCommands(program);
    const bad = [
      '--threshold', '80',
      '--action', 'nope',
      '--frequency', 'every_action',
      '--model', 'gpt-4o',
    ];
    await expect(
      program.parseAsync(['node', 'openbox', 'goal', 'update', 'agent-1', ...bad]),
    ).rejects.toThrow();
    expect(mockClient.updateGoalAlignment).not.toHaveBeenCalled();
  });

  it('update rejects non-integer --threshold', async () => {
    const program = createTestProgram();
    registerGoalCommands(program);
    const bad = [
      '--threshold', 'big',
      '--action', 'alert_only',
      '--frequency', 'every_action',
      '--model', 'gpt-4o',
    ];
    await expect(
      program.parseAsync(['node', 'openbox', 'goal', 'update', 'agent-1', ...bad]),
    ).rejects.toThrow();
  });

  it('update --json bypasses the four-field requirement and passes body through', async () => {
    const program = createTestProgram();
    registerGoalCommands(program);
    await program.parseAsync([
      'node', 'openbox', 'goal', 'update', 'agent-1',
      '--body', '{"alignment_threshold":50,"custom":"x"}',
    ]);
    expect(mockClient.updateGoalAlignment).toHaveBeenCalledWith('agent-1', {
      alignment_threshold: 50,
      custom: 'x',
    });
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
    expect(mockClient.getGoalAlignmentRecentDrifts).toHaveBeenCalledWith('agent-1', { limit: 10 });
  });
});
