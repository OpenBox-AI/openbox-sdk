import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerTrustCommands } from '../../../ts/src/cli/commands/trust';
import { createMockClient, createTestProgram } from '../../helpers/cli';

vi.mock('../../../ts/src/cli/config', () => ({ getClient: vi.fn() }));
vi.mock('../../../ts/src/cli/output', () => ({
  output: vi.fn(), outputList: vi.fn(),
  error: vi.fn(), warn: vi.fn(), note: vi.fn(), banner: vi.fn(),
  info: vi.fn(), action: vi.fn(), success: vi.fn(),
  row: vi.fn(), summary: vi.fn(), kv: vi.fn(), table: vi.fn(),
}));

import { getClient } from '../../../ts/src/cli/config';

describe('trust commands', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(getClient).mockReturnValue(mockClient as any);
  });

  it('histories calls getTrustHistories with default duration', async () => {
    const program = createTestProgram();
    registerTrustCommands(program);
    await program.parseAsync(['node', 'openbox', 'trust', 'histories', 'agent-1']);
    expect(mockClient.getTrustHistories).toHaveBeenCalledWith('agent-1', '7d');
  });

  it('histories passes custom duration', async () => {
    const program = createTestProgram();
    registerTrustCommands(program);
    await program.parseAsync([
      'node',
      'openbox',
      'trust',
      'histories',
      'agent-1',
      '--duration',
      '30d',
    ]);
    expect(mockClient.getTrustHistories).toHaveBeenCalledWith('agent-1', '30d');
  });

  it('events calls getTrustEvents', async () => {
    const program = createTestProgram();
    registerTrustCommands(program);
    await program.parseAsync(['node', 'openbox', 'trust', 'events', 'agent-1']);
    expect(mockClient.getTrustEvents).toHaveBeenCalledWith('agent-1', expect.anything());
  });

  it('tier-changes calls getTrustTierChanges', async () => {
    const program = createTestProgram();
    registerTrustCommands(program);
    await program.parseAsync(['node', 'openbox', 'trust', 'tier-changes', 'agent-1']);
    expect(mockClient.getTrustTierChanges).toHaveBeenCalledWith('agent-1', expect.anything());
  });

  it('recovery calls getTrustRecoveryStatus', async () => {
    const program = createTestProgram();
    registerTrustCommands(program);
    await program.parseAsync(['node', 'openbox', 'trust', 'recovery', 'agent-1']);
    expect(mockClient.getTrustRecoveryStatus).toHaveBeenCalledWith('agent-1');
  });
});
