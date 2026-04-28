import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerAgentCommands } from '../../../ts/src/cli/commands/agent';
import { createMockClient, createTestProgram } from '../../helpers/cli';

vi.mock('../../../ts/src/cli/config', () => ({ getClient: vi.fn() }));
vi.mock('../../../ts/src/cli/output', () => ({ output: vi.fn(), outputList: vi.fn() }));

import { getClient } from '../../../ts/src/cli/config';
import { output, outputList } from '../../../ts/src/cli/output';

describe('agent commands', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(getClient).mockReturnValue(mockClient as any);
  });

  it('list calls listAgents with default pagination', async () => {
    const program = createTestProgram();
    registerAgentCommands(program);
    await program.parseAsync(['node', 'openbox', 'agent', 'list']);
    expect(mockClient.listAgents).toHaveBeenCalledWith(
      expect.objectContaining({ page: 0, perPage: 10 }),
    );
    expect(outputList).toHaveBeenCalledWith(expect.anything(), 'agents');
  });

  it('list passes search and custom pagination', async () => {
    const program = createTestProgram();
    registerAgentCommands(program);
    await program.parseAsync([
      'node',
      'openbox',
      'agent',
      'list',
      '-p',
      '2',
      '-l',
      '25',
      '-s',
      'bot',
    ]);
    expect(mockClient.listAgents).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, perPage: 25, search: 'bot' }),
    );
  });

  it('create calls createAgent with name', async () => {
    const program = createTestProgram();
    registerAgentCommands(program);
    await program.parseAsync([
      'node',
      'openbox',
      'agent',
      'create',
      '-n',
      'MyAgent',
      '-t',
      '00000000-0000-0000-0000-000000000001',
      '--skip-preflight',
    ]);
    expect(mockClient.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agent_name: 'MyAgent', icon: 'robot' }),
    );
    expect(output).toHaveBeenCalled();
  });

  it('create with --json overrides', async () => {
    const program = createTestProgram();
    registerAgentCommands(program);
    const json = JSON.stringify({ agent_name: 'Custom', team_ids: [] });
    await program.parseAsync(['node', 'openbox', 'agent', 'create', '-n', 'x', '--json', json]);
    expect(mockClient.createAgent).toHaveBeenCalledWith(JSON.parse(json));
  });

  it('get calls getAgent with agentId', async () => {
    const program = createTestProgram();
    registerAgentCommands(program);
    await program.parseAsync(['node', 'openbox', 'agent', 'get', 'agent-123']);
    expect(mockClient.getAgent).toHaveBeenCalledWith('agent-123');
  });

  it('update calls updateAgent', async () => {
    const program = createTestProgram();
    registerAgentCommands(program);
    await program.parseAsync([
      'node',
      'openbox',
      'agent',
      'update',
      'agent-1',
      '-n',
      'NewName',
      '-d',
      'desc',
    ]);
    expect(mockClient.updateAgent).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({ agent_name: 'NewName', description: 'desc' }),
    );
  });

  it('delete calls deleteAgent', async () => {
    const program = createTestProgram();
    registerAgentCommands(program);
    await program.parseAsync(['node', 'openbox', 'agent', 'delete', 'agent-1']);
    expect(mockClient.deleteAgent).toHaveBeenCalledWith('agent-1');
  });

  it('handles errors gracefully', async () => {
    mockClient.getAgent.mockRejectedValue(new Error('Not found'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const program = createTestProgram();
    registerAgentCommands(program);
    await program.parseAsync(['node', 'openbox', 'agent', 'get', 'bad']);

    expect(errorSpy).toHaveBeenCalledWith('Not found');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
