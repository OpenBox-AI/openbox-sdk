import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerAivssCommands } from '../../../ts/cli/src/commands/aivss';
import { createMockClient, createTestProgram } from '../../helpers/cli';

vi.mock('../../../ts/cli/src/config', () => ({ getClient: vi.fn() }));
vi.mock('../../../ts/cli/src/output', () => ({ output: vi.fn(), outputList: vi.fn() }));

import { getClient } from '../../../ts/cli/src/config';

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

  it('update calls updateAivssConfig', async () => {
    const program = createTestProgram();
    registerAivssCommands(program);
    const json = JSON.stringify({ base_security: {} });
    await program.parseAsync([
      'node',
      'openbox',
      'aivss',
      'update',
      'agent-1',
      '--json',
      json,
      '--reason',
      'test',
    ]);
    expect(mockClient.updateAivssConfig).toHaveBeenCalledWith('agent-1', {
      aivss_config: JSON.parse(json),
      reason: 'test',
    });
  });

  it('recalculate calls recalculateAivss', async () => {
    const program = createTestProgram();
    registerAivssCommands(program);
    await program.parseAsync(['node', 'openbox', 'aivss', 'recalculate', 'agent-1']);
    expect(mockClient.recalculateAivss).toHaveBeenCalledWith('agent-1');
  });

  it('calculate calls calculateAivss', async () => {
    const program = createTestProgram();
    registerAivssCommands(program);
    const json = JSON.stringify({ base_security: {} });
    await program.parseAsync(['node', 'openbox', 'aivss', 'calculate', '--json', json]);
    expect(mockClient.calculateAivss).toHaveBeenCalledWith(JSON.parse(json));
  });
});
