import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerObservabilityCommands } from '../../../ts/src/cli/commands/observability';
import { createMockClient, createTestProgram } from '../../helpers/cli';

vi.mock('../../../ts/src/cli/config', () => ({ getClient: vi.fn() }));
vi.mock('../../../ts/src/cli/output', () => ({ output: vi.fn(), outputList: vi.fn() }));

import { getClient } from '../../../ts/src/cli/config';

describe('observability commands', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(getClient).mockReturnValue(mockClient as any);
  });

  it('data calls getObservability', async () => {
    const program = createTestProgram();
    registerObservabilityCommands(program);
    await program.parseAsync(['node', 'openbox', 'observe', 'data', 'agent-1']);
    expect(mockClient.getObservability).toHaveBeenCalledWith('agent-1', expect.anything());
  });

  it('issues calls getIssues', async () => {
    const program = createTestProgram();
    registerObservabilityCommands(program);
    await program.parseAsync(['node', 'openbox', 'observe', 'issues', 'agent-1']);
    expect(mockClient.getIssues).toHaveBeenCalledWith('agent-1', expect.anything());
  });

  it('insights calls getInsightsMetrics', async () => {
    const program = createTestProgram();
    registerObservabilityCommands(program);
    await program.parseAsync(['node', 'openbox', 'observe', 'insights', 'agent-1']);
    expect(mockClient.getInsightsMetrics).toHaveBeenCalled();
  });

  it('logs calls getAgentLogs', async () => {
    const program = createTestProgram();
    registerObservabilityCommands(program);
    await program.parseAsync(['node', 'openbox', 'observe', 'logs', 'agent-1']);
    expect(mockClient.getAgentLogs).toHaveBeenCalledWith('agent-1', expect.anything());
  });

  it('drift calls getDriftLogs', async () => {
    const program = createTestProgram();
    registerObservabilityCommands(program);
    await program.parseAsync(['node', 'openbox', 'observe', 'drift', 'agent-1']);
    expect(mockClient.getDriftLogs).toHaveBeenCalledWith('agent-1', expect.anything());
  });

  it('metrics calls getAgentMetrics', async () => {
    const program = createTestProgram();
    registerObservabilityCommands(program);
    await program.parseAsync(['node', 'openbox', 'observe', 'metrics']);
    expect(mockClient.getAgentMetrics).toHaveBeenCalled();
  });
});
