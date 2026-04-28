import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerAuditCommands } from '../../../ts/src/cli/commands/audit';
import { createMockClient, createTestProgram } from '../../helpers/cli';

vi.mock('../../../ts/src/cli/config', () => ({ getClient: vi.fn() }));
vi.mock('../../../ts/src/cli/output', () => ({ output: vi.fn(), outputList: vi.fn() }));

import { getClient } from '../../../ts/src/cli/config';

describe('audit commands', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(getClient).mockReturnValue(mockClient as any);
  });

  it('list calls getAuditLogs', async () => {
    const program = createTestProgram();
    registerAuditCommands(program);
    await program.parseAsync(['node', 'openbox', 'audit', 'list']);
    expect(mockClient.getAuditLogs).toHaveBeenCalled();
  });

  it('get calls getAuditLog', async () => {
    const program = createTestProgram();
    registerAuditCommands(program);
    await program.parseAsync(['node', 'openbox', 'audit', 'get', 'log-1']);
    expect(mockClient.getAuditLog).toHaveBeenCalledWith('log-1');
  });

  it('export calls exportAuditLogs', async () => {
    const program = createTestProgram();
    registerAuditCommands(program);
    await program.parseAsync(['node', 'openbox', 'audit', 'export', '-n', 'MyExport']);
    expect(mockClient.exportAuditLogs).toHaveBeenCalledWith(
      expect.objectContaining({ exportName: 'MyExport' }),
    );
  });

  it('preview calls previewAuditExport', async () => {
    const program = createTestProgram();
    registerAuditCommands(program);
    await program.parseAsync(['node', 'openbox', 'audit', 'preview']);
    expect(mockClient.previewAuditExport).toHaveBeenCalled();
  });

  it('exports calls getExportHistory', async () => {
    const program = createTestProgram();
    registerAuditCommands(program);
    await program.parseAsync(['node', 'openbox', 'audit', 'exports']);
    expect(mockClient.getExportHistory).toHaveBeenCalled();
  });

  it('download calls downloadExport', async () => {
    const program = createTestProgram();
    registerAuditCommands(program);
    await program.parseAsync(['node', 'openbox', 'audit', 'download', 'exp-1']);
    expect(mockClient.downloadExport).toHaveBeenCalledWith('exp-1');
  });

  it('delete-export calls deleteExport', async () => {
    const program = createTestProgram();
    registerAuditCommands(program);
    await program.parseAsync(['node', 'openbox', 'audit', 'delete-export', 'exp-1']);
    expect(mockClient.deleteExport).toHaveBeenCalledWith('exp-1');
  });
});
