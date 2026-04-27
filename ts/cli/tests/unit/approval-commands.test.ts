// Unit tests for approval decide - the only destructive approval command.
// Verifies enum validation of <action> and the decideApproval call shape.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { makeMockClient, type MockClient } from '../helpers/mock-client.js';

const mockClient: MockClient = makeMockClient();

vi.mock('../../src/config.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../src/config.js',
  );
  return { ...actual, getClient: () => mockClient };
});

import { registerApprovalCommands } from '../../src/commands/approval.js';

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerApprovalCommands(program);
  return program;
}

beforeEach(() => {
  mockClient.__calls.length = 0;
  mockClient.__responses.decideApproval = { ok: true };
});

describe('approval decide', () => {
  it('accepts action=approve', async () => {
    await makeProgram().parseAsync([
      'node',
      'openbox',
      'approval',
      'decide',
      'agent-1',
      'event-1',
      'approve',
    ]);
    expect(mockClient.__calls[0].method).toBe('decideApproval');
    expect(mockClient.__calls[0].args).toEqual(['agent-1', 'event-1', 'approve']);
  });

  it('accepts action=reject', async () => {
    await makeProgram().parseAsync([
      'node',
      'openbox',
      'approval',
      'decide',
      'agent-1',
      'event-1',
      'reject',
    ]);
    expect(mockClient.__calls[0].args[2]).toBe('reject');
  });

  it('rejects invalid action (not approve/reject)', async () => {
    await expect(
      makeProgram().parseAsync([
        'node',
        'openbox',
        'approval',
        'decide',
        'agent-1',
        'event-1',
        'maybe',
      ]),
    ).rejects.toThrow();
    expect(mockClient.__calls).toHaveLength(0);
  });

  it('requires all three positional args', async () => {
    await expect(
      makeProgram().parseAsync(['node', 'openbox', 'approval', 'decide', 'agent-1']),
    ).rejects.toThrow();
  });
});
