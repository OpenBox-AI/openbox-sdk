import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerBehaviorCommands } from '../../../ts/src/cli/commands/behavior';
import { createMockClient, createTestProgram } from '../../helpers/cli';

vi.mock('../../../ts/src/cli/config', () => ({ getClient: vi.fn() }));
vi.mock('../../../ts/src/cli/output', () => ({ output: vi.fn(), outputList: vi.fn() }));

import { getClient } from '../../../ts/src/cli/config';

describe('behavior commands', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(getClient).mockReturnValue(mockClient as any);
  });

  it('types calls getSemanticTypes', async () => {
    const program = createTestProgram();
    registerBehaviorCommands(program);
    await program.parseAsync(['node', 'openbox', 'behavior', 'types']);
    expect(mockClient.getSemanticTypes).toHaveBeenCalled();
  });

  it('list calls listBehaviorRules', async () => {
    const program = createTestProgram();
    registerBehaviorCommands(program);
    await program.parseAsync(['node', 'openbox', 'behavior', 'list', 'agent-1']);
    expect(mockClient.listBehaviorRules).toHaveBeenCalledWith('agent-1', expect.anything());
  });

  it('current calls getCurrentBehaviorRules', async () => {
    const program = createTestProgram();
    registerBehaviorCommands(program);
    await program.parseAsync(['node', 'openbox', 'behavior', 'current', 'agent-1']);
    expect(mockClient.getCurrentBehaviorRules).toHaveBeenCalledWith('agent-1');
  });

  it('create calls createBehaviorRule', async () => {
    const program = createTestProgram();
    registerBehaviorCommands(program);
    await program.parseAsync([
      'node',
      'openbox',
      'behavior',
      'create',
      'agent-1',
      '-n',
      'Rule1',
      '--trigger',
      'http',
      '--states',
      'http_get',
      '--window',
      '60',
      '--verdict',
      '2',
      '--approval-timeout',
      '300',
      '--message',
      'blocked',
    ]);
    expect(mockClient.createBehaviorRule).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({ rule_name: 'Rule1', trigger: 'http', verdict: 2 }),
    );
  });

  it('get calls getBehaviorRule', async () => {
    const program = createTestProgram();
    registerBehaviorCommands(program);
    await program.parseAsync(['node', 'openbox', 'behavior', 'get', 'agent-1', 'rule-1']);
    expect(mockClient.getBehaviorRule).toHaveBeenCalledWith('agent-1', 'rule-1');
  });

  it('update calls updateBehaviorRule with JSON', async () => {
    const program = createTestProgram();
    registerBehaviorCommands(program);
    const json = JSON.stringify({ rule_name: 'Updated', change_log: 'test' });
    await program.parseAsync([
      'node',
      'openbox',
      'behavior',
      'update',
      'agent-1',
      'rule-1',
      '--body',
      json,
    ]);
    expect(mockClient.updateBehaviorRule).toHaveBeenCalledWith(
      'agent-1',
      'rule-1',
      JSON.parse(json),
    );
  });

  it('delete calls deleteBehaviorRule', async () => {
    const program = createTestProgram();
    registerBehaviorCommands(program);
    await program.parseAsync(['node', 'openbox', 'behavior', 'delete', 'agent-1', 'rule-1']);
    expect(mockClient.deleteBehaviorRule).toHaveBeenCalledWith('agent-1', 'rule-1');
  });

  // `behavior restore` was removed; endpoint POST /agent/{agentId}/
  // behavior-rule/{ruleId} isn't in the OpenAPI spec. Restore the
  // subcommand + this test once the backend grows the endpoint.

  it('toggle calls toggleBehaviorRuleStatus', async () => {
    const program = createTestProgram();
    registerBehaviorCommands(program);
    await program.parseAsync([
      'node',
      'openbox',
      'behavior',
      'toggle',
      'agent-1',
      'rule-1',
      '--active',
      'true',
    ]);
    expect(mockClient.toggleBehaviorRuleStatus).toHaveBeenCalledWith('agent-1', 'rule-1', {
      is_active: true,
    });
  });

  it('versions calls getBehaviorRuleVersions', async () => {
    const program = createTestProgram();
    registerBehaviorCommands(program);
    await program.parseAsync(['node', 'openbox', 'behavior', 'versions', 'agent-1', 'group-1']);
    expect(mockClient.getBehaviorRuleVersions).toHaveBeenCalledWith(
      'agent-1',
      'group-1',
      expect.anything(),
    );
  });

  it('metrics calls getBehaviorMetrics', async () => {
    const program = createTestProgram();
    registerBehaviorCommands(program);
    await program.parseAsync(['node', 'openbox', 'behavior', 'metrics', 'agent-1']);
    expect(mockClient.getBehaviorMetrics).toHaveBeenCalled();
  });

  it('violations calls getBehaviorViolations', async () => {
    const program = createTestProgram();
    registerBehaviorCommands(program);
    await program.parseAsync(['node', 'openbox', 'behavior', 'violations', 'agent-1']);
    expect(mockClient.getBehaviorViolations).toHaveBeenCalled();
  });
});
