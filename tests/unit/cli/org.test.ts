import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerOrgCommands } from '../../../ts/src/cli/commands/org';
import { createMockClient, createTestProgram } from '../../helpers/cli';

vi.mock('../../../ts/src/cli/config', () => ({ getClient: vi.fn() }));
vi.mock('../../../ts/src/cli/output', () => ({
  output: vi.fn(), outputList: vi.fn(),
  error: vi.fn(), warn: vi.fn(), note: vi.fn(), banner: vi.fn(),
  info: vi.fn(), action: vi.fn(), success: vi.fn(),
  row: vi.fn(), summary: vi.fn(), kv: vi.fn(), table: vi.fn(),
}));

import { getClient } from '../../../ts/src/cli/config';

describe('org commands', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(getClient).mockReturnValue(mockClient as any);
  });

  it('get calls getOrganization', async () => {
    const program = createTestProgram();
    registerOrgCommands(program);
    await program.parseAsync(['node', 'openbox', 'org', 'get', 'org-1']);
    expect(mockClient.getOrganization).toHaveBeenCalledWith('org-1');
  });

  it('settings calls getOrgSettings', async () => {
    const program = createTestProgram();
    registerOrgCommands(program);
    await program.parseAsync(['node', 'openbox', 'org', 'settings', 'org-1']);
    expect(mockClient.getOrgSettings).toHaveBeenCalledWith('org-1');
  });

  it('update-settings calls updateOrgSettings', async () => {
    const program = createTestProgram();
    registerOrgCommands(program);
    await program.parseAsync([
      'node',
      'openbox',
      'org',
      'update-settings',
      'org-1',
      '-n',
      'NewName',
    ]);
    expect(mockClient.updateOrgSettings).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ name: 'NewName' }),
    );
  });

  it('dashboard calls getDashboard', async () => {
    const program = createTestProgram();
    registerOrgCommands(program);
    await program.parseAsync(['node', 'openbox', 'org', 'dashboard', 'org-1']);
    expect(mockClient.getDashboard).toHaveBeenCalledWith('org-1', expect.anything());
  });

  it('trends calls getDashboardTierTrends', async () => {
    const program = createTestProgram();
    registerOrgCommands(program);
    await program.parseAsync(['node', 'openbox', 'org', 'trends', 'org-1']);
    expect(mockClient.getDashboardTierTrends).toHaveBeenCalledWith('org-1');
  });

  it('sessions calls getOrgSessions', async () => {
    const program = createTestProgram();
    registerOrgCommands(program);
    await program.parseAsync(['node', 'openbox', 'org', 'sessions', 'org-1']);
    expect(mockClient.getOrgSessions).toHaveBeenCalledWith('org-1', expect.anything());
  });

  it('approvals calls getOrgApprovals', async () => {
    const program = createTestProgram();
    registerOrgCommands(program);
    await program.parseAsync(['node', 'openbox', 'org', 'approvals', 'org-1']);
    expect(mockClient.getOrgApprovals).toHaveBeenCalledWith('org-1', expect.anything());
  });

  it('approval-metrics calls getOrgApprovalMetrics', async () => {
    const program = createTestProgram();
    registerOrgCommands(program);
    await program.parseAsync(['node', 'openbox', 'org', 'approval-metrics', 'org-1']);
    expect(mockClient.getOrgApprovalMetrics).toHaveBeenCalledWith('org-1', expect.anything());
  });

  it('approval-sla calls getOrgApprovalSla', async () => {
    const program = createTestProgram();
    registerOrgCommands(program);
    await program.parseAsync(['node', 'openbox', 'org', 'approval-sla', 'org-1']);
    expect(mockClient.getOrgApprovalSla).toHaveBeenCalledWith('org-1');
  });

  it('approval-history calls getOrgApprovalHistory', async () => {
    const program = createTestProgram();
    registerOrgCommands(program);
    await program.parseAsync(['node', 'openbox', 'org', 'approval-history', 'org-1']);
    expect(mockClient.getOrgApprovalHistory).toHaveBeenCalledWith('org-1', expect.anything());
  });
});
