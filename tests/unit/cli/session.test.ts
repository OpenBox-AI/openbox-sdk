import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerSessionCommands } from '../../../ts/src/cli/commands/session';
import { createMockClient, createTestProgram } from '../../helpers/cli';

vi.mock('../../../ts/src/cli/config', () => ({ getClient: vi.fn() }));
vi.mock('../../../ts/src/cli/output', () => ({ output: vi.fn(), outputList: vi.fn() }));

import { getClient } from '../../../ts/src/cli/config';

describe('session commands', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(getClient).mockReturnValue(mockClient as any);
  });

  it('list calls listSessions', async () => {
    const program = createTestProgram();
    registerSessionCommands(program);
    await program.parseAsync(['node', 'openbox', 'session', 'list', 'agent-1']);
    expect(mockClient.listSessions).toHaveBeenCalledWith('agent-1', expect.anything());
  });

  it('active calls getActiveSessions', async () => {
    const program = createTestProgram();
    registerSessionCommands(program);
    await program.parseAsync(['node', 'openbox', 'session', 'active', 'agent-1']);
    expect(mockClient.getActiveSessions).toHaveBeenCalledWith('agent-1');
  });

  it('get calls getSession', async () => {
    const program = createTestProgram();
    registerSessionCommands(program);
    await program.parseAsync(['node', 'openbox', 'session', 'get', 'agent-1', 'sess-1']);
    expect(mockClient.getSession).toHaveBeenCalledWith('agent-1', 'sess-1');
  });

  it('logs calls getSessionLogs', async () => {
    const program = createTestProgram();
    registerSessionCommands(program);
    await program.parseAsync(['node', 'openbox', 'session', 'logs', 'agent-1', 'sess-1']);
    expect(mockClient.getSessionLogs).toHaveBeenCalledWith('agent-1', 'sess-1', expect.anything());
  });

  it('goal-stats calls getSessionGoalAlignmentStats', async () => {
    const program = createTestProgram();
    registerSessionCommands(program);
    await program.parseAsync(['node', 'openbox', 'session', 'goal-stats', 'agent-1', 'sess-1']);
    expect(mockClient.getSessionGoalAlignmentStats).toHaveBeenCalledWith('agent-1', 'sess-1');
  });

  it('trace calls getSessionReasoningTrace', async () => {
    const program = createTestProgram();
    registerSessionCommands(program);
    await program.parseAsync(['node', 'openbox', 'session', 'trace', 'agent-1', 'sess-1']);
    expect(mockClient.getSessionReasoningTrace).toHaveBeenCalledWith('agent-1', 'sess-1');
  });

  it('terminate calls terminateSession', async () => {
    const program = createTestProgram();
    registerSessionCommands(program);
    await program.parseAsync(['node', 'openbox', 'session', 'terminate', 'agent-1', 'sess-1']);
    expect(mockClient.terminateSession).toHaveBeenCalledWith('agent-1', 'sess-1');
  });
});
