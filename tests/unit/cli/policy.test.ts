import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerPolicyCommands } from '../../../packages/cli/src/commands/policy';
import { createMockClient, createTestProgram } from '../../helpers/cli';

vi.mock('../../../packages/cli/src/config', () => ({ getClient: vi.fn() }));
vi.mock('../../../packages/cli/src/output', () => ({ output: vi.fn(), outputList: vi.fn() }));

import { getClient } from '../../../packages/cli/src/config';
import { output, outputList } from '../../../packages/cli/src/output';

describe('policy commands', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(getClient).mockReturnValue(mockClient as any);
  });

  it('list calls listPolicies', async () => {
    const program = createTestProgram();
    registerPolicyCommands(program);
    await program.parseAsync(['node', 'openbox', 'policy', 'list', 'agent-1']);
    expect(mockClient.listPolicies).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({ page: 0, perPage: 10 }),
    );
    expect(outputList).toHaveBeenCalled();
  });

  it('create calls createPolicy', async () => {
    const program = createTestProgram();
    registerPolicyCommands(program);
    await program.parseAsync([
      'node',
      'openbox',
      'policy',
      'create',
      'agent-1',
      '-n',
      'Pol1',
      '--rego',
      'package p',
      '--input',
      '{}',
    ]);
    expect(mockClient.createPolicy).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({ name: 'Pol1' }),
    );
  });

  it('current calls getCurrentPolicies', async () => {
    const program = createTestProgram();
    registerPolicyCommands(program);
    await program.parseAsync(['node', 'openbox', 'policy', 'current', 'agent-1']);
    expect(mockClient.getCurrentPolicies).toHaveBeenCalledWith('agent-1');
  });

  it('get calls getPolicy', async () => {
    const program = createTestProgram();
    registerPolicyCommands(program);
    await program.parseAsync(['node', 'openbox', 'policy', 'get', 'agent-1', 'pol-1']);
    expect(mockClient.getPolicy).toHaveBeenCalledWith('agent-1', 'pol-1');
  });

  it('update calls updatePolicy', async () => {
    const program = createTestProgram();
    registerPolicyCommands(program);
    await program.parseAsync([
      'node',
      'openbox',
      'policy',
      'update',
      'agent-1',
      'pol-1',
      '--active',
      'true',
    ]);
    expect(mockClient.updatePolicy).toHaveBeenCalledWith('agent-1', 'pol-1', expect.anything());
  });

  it('evaluations calls getPolicyEvaluations', async () => {
    const program = createTestProgram();
    registerPolicyCommands(program);
    await program.parseAsync(['node', 'openbox', 'policy', 'evaluations', 'agent-1', 'pol-1']);
    expect(mockClient.getPolicyEvaluations).toHaveBeenCalledWith(
      'agent-1',
      'pol-1',
      expect.anything(),
    );
  });

  it('metrics calls getPolicyMetrics', async () => {
    const program = createTestProgram();
    registerPolicyCommands(program);
    await program.parseAsync(['node', 'openbox', 'policy', 'metrics', 'agent-1']);
    expect(mockClient.getPolicyMetrics).toHaveBeenCalled();
  });

  it('evaluate calls evaluateRego', async () => {
    const program = createTestProgram();
    registerPolicyCommands(program);
    await program.parseAsync([
      'node',
      'openbox',
      'policy',
      'evaluate',
      '--rego',
      'package p',
      '--input',
      '{}',
    ]);
    expect(mockClient.evaluateRego).toHaveBeenCalled();
  });
});
