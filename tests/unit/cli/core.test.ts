import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerCoreCommands } from '../../../ts/src/cli/commands/core';
import { createTestProgram } from '../../helpers/cli';

vi.mock('../../../ts/src/cli/config', () => ({ getCoreClient: vi.fn() }));
vi.mock('../../../ts/src/cli/output', () => ({
  output: vi.fn(), outputList: vi.fn(),
  error: vi.fn(), warn: vi.fn(), note: vi.fn(), banner: vi.fn(),
  info: vi.fn(), action: vi.fn(), success: vi.fn(),
  row: vi.fn(), summary: vi.fn(), kv: vi.fn(), table: vi.fn(),
}));

import { getCoreClient } from '../../../ts/src/cli/config';
import { output } from '../../../ts/src/cli/output';

describe('core commands', () => {
  let mockClient: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = {
      health: vi.fn().mockResolvedValue('hello world'),
      validateApiKey: vi.fn().mockResolvedValue({ valid: true }),
      evaluate: vi.fn().mockResolvedValue({ verdict: 'ALLOW', action: 'allow' }),
      pollApproval: vi.fn().mockResolvedValue({ verdict: 'ALLOW', expired: false }),
    };
    vi.mocked(getCoreClient).mockReturnValue(mockClient as any);
  });

  it('health calls core health()', async () => {
    const program = createTestProgram();
    registerCoreCommands(program);
    await program.parseAsync(['node', 'openbox', 'core', 'health']);
    expect(mockClient.health).toHaveBeenCalled();
    expect(output).toHaveBeenCalled();
  });

  it('validate calls validateApiKey()', async () => {
    const program = createTestProgram();
    registerCoreCommands(program);
    await program.parseAsync(['node', 'openbox', 'core', 'validate']);
    expect(mockClient.validateApiKey).toHaveBeenCalled();
  });

  it('evaluate calls evaluate() with JSON payload', async () => {
    const program = createTestProgram();
    registerCoreCommands(program);
    const json = JSON.stringify({
      event_type: 'ActivityStarted',
      workflow_id: 'wf',
      run_id: 'run',
    });
    await program.parseAsync(['node', 'openbox', 'core', 'evaluate', '--json', json]);
    expect(mockClient.evaluate).toHaveBeenCalledWith(JSON.parse(json));
  });

  it('poll-approval calls pollApproval()', async () => {
    const program = createTestProgram();
    registerCoreCommands(program);
    await program.parseAsync([
      'node',
      'openbox',
      'core',
      'poll-approval',
      '--workflow-id',
      'wf-1',
      '--run-id',
      'run-1',
      '--activity-id',
      'act-1',
    ]);
    expect(mockClient.pollApproval).toHaveBeenCalledWith({
      workflow_id: 'wf-1',
      run_id: 'run-1',
      activity_id: 'act-1',
    });
  });
});
