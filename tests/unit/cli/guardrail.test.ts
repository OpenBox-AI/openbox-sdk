import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerGuardrailCommands } from '../../../ts/cli/src/commands/guardrail';
import { createMockClient, createTestProgram } from '../../helpers/cli';

vi.mock('../../../ts/cli/src/config', () => ({ getClient: vi.fn() }));
vi.mock('../../../ts/cli/src/output', () => ({ output: vi.fn(), outputList: vi.fn() }));

import { getClient } from '../../../ts/cli/src/config';
import { output, outputList } from '../../../ts/cli/src/output';

describe('guardrail commands', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(getClient).mockReturnValue(mockClient as any);
  });

  it('list calls listGuardrails with agentId', async () => {
    const program = createTestProgram();
    registerGuardrailCommands(program);
    await program.parseAsync(['node', 'openbox', 'guardrail', 'list', 'agent-1']);
    expect(mockClient.listGuardrails).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({ page: 0, perPage: 10 }),
    );
    expect(outputList).toHaveBeenCalled();
  });

  it('create calls createGuardrail', async () => {
    const program = createTestProgram();
    registerGuardrailCommands(program);
    await program.parseAsync([
      'node',
      'openbox',
      'guardrail',
      'create',
      'agent-1',
      '-n',
      'Guard1',
      '--type',
      'pii',
      '--stage',
      '0',
    ]);
    // GUARDRAIL_TYPE_MAP maps 'pii' -> '1' (backend enum) and stage must be
    // '0' or '1' per the backend guardrails service (any other value silently
    // disables all checks, which is why the CLI validates strictly here).
    expect(mockClient.createGuardrail).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({ name: 'Guard1', guardrail_type: '1', processing_stage: '0' }),
    );
  });

  it('get calls getGuardrail', async () => {
    const program = createTestProgram();
    registerGuardrailCommands(program);
    await program.parseAsync(['node', 'openbox', 'guardrail', 'get', 'agent-1', 'guard-1']);
    expect(mockClient.getGuardrail).toHaveBeenCalledWith('agent-1', 'guard-1');
  });

  it('update calls updateGuardrail', async () => {
    const program = createTestProgram();
    registerGuardrailCommands(program);
    await program.parseAsync([
      'node',
      'openbox',
      'guardrail',
      'update',
      'agent-1',
      'guard-1',
      '-n',
      'NewName',
    ]);
    expect(mockClient.updateGuardrail).toHaveBeenCalledWith(
      'agent-1',
      'guard-1',
      expect.objectContaining({ name: 'NewName' }),
    );
  });

  it('delete calls deleteGuardrail', async () => {
    const program = createTestProgram();
    registerGuardrailCommands(program);
    await program.parseAsync(['node', 'openbox', 'guardrail', 'delete', 'agent-1', 'guard-1']);
    expect(mockClient.deleteGuardrail).toHaveBeenCalledWith('agent-1', 'guard-1');
  });

  it('reorder calls reorderGuardrail', async () => {
    const program = createTestProgram();
    registerGuardrailCommands(program);
    await program.parseAsync([
      'node',
      'openbox',
      'guardrail',
      'reorder',
      'agent-1',
      'guard-1',
      '3',
    ]);
    expect(mockClient.reorderGuardrail).toHaveBeenCalledWith('agent-1', 'guard-1', 3);
  });

  it('metrics calls getGuardrailMetrics', async () => {
    const program = createTestProgram();
    registerGuardrailCommands(program);
    await program.parseAsync(['node', 'openbox', 'guardrail', 'metrics', 'agent-1']);
    expect(mockClient.getGuardrailMetrics).toHaveBeenCalledWith('agent-1', expect.anything());
  });

  it('violations calls getGuardrailViolationLogs', async () => {
    const program = createTestProgram();
    registerGuardrailCommands(program);
    await program.parseAsync(['node', 'openbox', 'guardrail', 'violations', 'agent-1']);
    expect(mockClient.getGuardrailViolationLogs).toHaveBeenCalledWith('agent-1', expect.anything());
  });

  it('test calls runGuardrailTest', async () => {
    const program = createTestProgram();
    registerGuardrailCommands(program);
    await program.parseAsync(['node', 'openbox', 'guardrail', 'test', '--type', 'pii']);
    expect(mockClient.runGuardrailTest).toHaveBeenCalled();
  });
});
