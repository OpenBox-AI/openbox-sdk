// Unit tests for api-key rotate / revoke - short commands but destructive;
// assert the right client method fires with the right agentId.

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

import { registerApiKeyCommands } from '../../src/commands/api-key.js';

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerApiKeyCommands(program);
  return program;
}

beforeEach(() => {
  mockClient.__calls.length = 0;
  mockClient.__responses.rotateApiKey = { api_key: 'obx_new' };
  mockClient.__responses.revokeApiKey = { ok: true };
});

describe('api-key rotate', () => {
  it('calls rotateApiKey with the agentId', async () => {
    await makeProgram().parseAsync(['node', 'openbox', 'api-key', 'rotate', 'agent-1']);
    expect(mockClient.__calls).toHaveLength(1);
    expect(mockClient.__calls[0].method).toBe('rotateApiKey');
    expect(mockClient.__calls[0].args[0]).toBe('agent-1');
  });

  it('requires an agentId', async () => {
    await expect(
      makeProgram().parseAsync(['node', 'openbox', 'api-key', 'rotate']),
    ).rejects.toThrow();
    expect(mockClient.__calls).toHaveLength(0);
  });
});

describe('api-key revoke', () => {
  it('calls revokeApiKey with the agentId', async () => {
    await makeProgram().parseAsync(['node', 'openbox', 'api-key', 'revoke', 'agent-1']);
    expect(mockClient.__calls[0].method).toBe('revokeApiKey');
    expect(mockClient.__calls[0].args[0]).toBe('agent-1');
  });

  it('does not call rotate by mistake', async () => {
    await makeProgram().parseAsync(['node', 'openbox', 'api-key', 'revoke', 'agent-1']);
    expect(mockClient.__calls.some((c) => c.method === 'rotateApiKey')).toBe(false);
  });
});
