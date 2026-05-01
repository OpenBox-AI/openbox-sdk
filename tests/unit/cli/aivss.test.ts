import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerAivssCommands } from '../../../ts/src/cli/commands/aivss';
import { createMockClient, createTestProgram } from '../../helpers/cli';

vi.mock('../../../ts/src/cli/config', () => ({ getClient: vi.fn() }));
vi.mock('../../../ts/src/cli/output', () => ({ output: vi.fn(), outputList: vi.fn() }));

import { getClient } from '../../../ts/src/cli/config';

describe('aivss commands', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(getClient).mockReturnValue(mockClient as any);
  });

  it('assessments calls getAssessments', async () => {
    const program = createTestProgram();
    registerAivssCommands(program);
    await program.parseAsync(['node', 'openbox', 'aivss', 'assessments', 'agent-1']);
    expect(mockClient.getAssessments).toHaveBeenCalledWith('agent-1', expect.anything());
  });

  it('update wraps --json as aivss_config alongside --reason', async () => {
    const program = createTestProgram();
    registerAivssCommands(program);
    const json = JSON.stringify({ base_security: { attack_vector: 3 } });
    await program.parseAsync([
      'node', 'openbox', 'aivss', 'update', 'agent-1',
      '--json', json,
      '--reason', 'quarterly review',
    ]);
    expect(mockClient.updateAivssConfig).toHaveBeenCalledWith('agent-1', {
      aivss_config: JSON.parse(json),
      reason: 'quarterly review',
    });
  });

  it('update requires --json and --reason', async () => {
    const program = createTestProgram();
    registerAivssCommands(program);
    await expect(
      program.parseAsync(['node', 'openbox', 'aivss', 'update', 'agent-1']),
    ).rejects.toThrow();
    expect(mockClient.updateAivssConfig).not.toHaveBeenCalled();
  });

  it('update rejects invalid JSON', async () => {
    const program = createTestProgram();
    registerAivssCommands(program);
    await expect(
      program.parseAsync([
        'node', 'openbox', 'aivss', 'update', 'agent-1',
        '--json', '{not json',
        '--reason', 'x',
      ]),
    ).rejects.toThrow();
  });

  it('recalculate calls recalculateAivss', async () => {
    const program = createTestProgram();
    registerAivssCommands(program);
    await program.parseAsync(['node', 'openbox', 'aivss', 'recalculate', 'agent-1']);
    expect(mockClient.recalculateAivss).toHaveBeenCalledWith('agent-1');
  });

  it('calculate passes --body straight through', async () => {
    const program = createTestProgram();
    registerAivssCommands(program);
    const json = JSON.stringify({ base_security: { attack_vector: 1 } });
    await program.parseAsync(['node', 'openbox', 'aivss', 'calculate', '--body', json]);
    expect(mockClient.calculateAivss).toHaveBeenCalledWith(JSON.parse(json));
  });

  it('calculate requires --body', async () => {
    const program = createTestProgram();
    registerAivssCommands(program);
    await expect(
      program.parseAsync(['node', 'openbox', 'aivss', 'calculate']),
    ).rejects.toThrow();
    expect(mockClient.calculateAivss).not.toHaveBeenCalled();
  });
});
