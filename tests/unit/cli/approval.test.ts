import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerApprovalCommands } from '../../../ts/src/cli/commands/approval';
import { createMockClient, createTestProgram } from '../../helpers/cli';

vi.mock('../../../ts/src/cli/config', () => ({ getClient: vi.fn() }));
vi.mock('../../../ts/src/cli/output', () => ({ output: vi.fn(), outputList: vi.fn() }));

import { getClient } from '../../../ts/src/cli/config';

describe('approval commands', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(getClient).mockReturnValue(mockClient as any);
  });

  it('metrics calls getApprovalMetrics', async () => {
    const program = createTestProgram();
    registerApprovalCommands(program);
    await program.parseAsync(['node', 'openbox', 'approval', 'metrics', 'agent-1']);
    expect(mockClient.getApprovalMetrics).toHaveBeenCalledWith('agent-1', expect.anything());
  });

  it('pending calls getPendingApprovals', async () => {
    const program = createTestProgram();
    registerApprovalCommands(program);
    await program.parseAsync(['node', 'openbox', 'approval', 'pending', 'agent-1']);
    expect(mockClient.getPendingApprovals).toHaveBeenCalledWith('agent-1', expect.anything());
  });

  it('history calls getApprovalHistory', async () => {
    const program = createTestProgram();
    registerApprovalCommands(program);
    await program.parseAsync(['node', 'openbox', 'approval', 'history', 'agent-1']);
    expect(mockClient.getApprovalHistory).toHaveBeenCalledWith('agent-1', expect.anything());
  });

  it('decide accepts action=approve', async () => {
    const program = createTestProgram();
    registerApprovalCommands(program);
    await program.parseAsync([
      'node', 'openbox', 'approval', 'decide', 'agent-1', 'evt-1', 'approve',
    ]);
    // decideApproval(agentId, eventId, { action }). Body object replaced the
    // positional string when the wire schema grew optional fields.
    expect(mockClient.decideApproval).toHaveBeenCalledWith('agent-1', 'evt-1', { action: 'approve' });
  });

  it('decide accepts action=reject', async () => {
    const program = createTestProgram();
    registerApprovalCommands(program);
    await program.parseAsync([
      'node', 'openbox', 'approval', 'decide', 'agent-1', 'evt-1', 'reject',
    ]);
    expect(mockClient.decideApproval).toHaveBeenCalledWith('agent-1', 'evt-1', { action: 'reject' });
  });

  it('decide rejects an invalid action', async () => {
    const program = createTestProgram();
    registerApprovalCommands(program);
    await expect(
      program.parseAsync(['node', 'openbox', 'approval', 'decide', 'agent-1', 'evt-1', 'maybe']),
    ).rejects.toThrow();
    expect(mockClient.decideApproval).not.toHaveBeenCalled();
  });

  it('decide requires all three positional args', async () => {
    const program = createTestProgram();
    registerApprovalCommands(program);
    await expect(
      program.parseAsync(['node', 'openbox', 'approval', 'decide', 'agent-1']),
    ).rejects.toThrow();
  });
});
