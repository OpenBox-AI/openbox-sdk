// Unit tests for aivss update / recalculate / calculate. `assessments` is a
// read-only paginated list covered by the parsePagination unit tests;
// focusing here on the write paths that actually mutate or compute.

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

import { registerAivssCommands } from '../../src/commands/aivss.js';

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerAivssCommands(program);
  return program;
}

beforeEach(() => {
  mockClient.__calls.length = 0;
  mockClient.__responses.updateAivssConfig = { ok: true };
  mockClient.__responses.recalculateAivss = { trust_score: 80 };
  mockClient.__responses.calculateAivss = { trust_score: 80 };
});

describe('aivss update', () => {
  it('requires --json and --reason', async () => {
    await expect(
      makeProgram().parseAsync(['node', 'openbox', 'aivss', 'update', 'agent-1']),
    ).rejects.toThrow();
  });

  it('wraps --json as aivss_config alongside --reason', async () => {
    await makeProgram().parseAsync([
      'node',
      'openbox',
      'aivss',
      'update',
      'agent-1',
      '--json',
      '{"base_security":{"attack_vector":3}}',
      '--reason',
      'quarterly review',
    ]);
    expect(mockClient.__calls[0].method).toBe('updateAivssConfig');
    expect(mockClient.__calls[0].args[1]).toEqual({
      aivss_config: { base_security: { attack_vector: 3 } },
      reason: 'quarterly review',
    });
  });

  it('rejects invalid JSON in --json', async () => {
    await expect(
      makeProgram().parseAsync([
        'node',
        'openbox',
        'aivss',
        'update',
        'agent-1',
        '--json',
        '{not json',
        '--reason',
        'x',
      ]),
    ).rejects.toThrow();
  });
});

describe('aivss recalculate', () => {
  it('fires recalculateAivss with the agentId (no body)', async () => {
    await makeProgram().parseAsync([
      'node',
      'openbox',
      'aivss',
      'recalculate',
      'agent-1',
    ]);
    expect(mockClient.__calls[0].method).toBe('recalculateAivss');
    expect(mockClient.__calls[0].args).toEqual(['agent-1']);
  });
});

describe('aivss calculate', () => {
  it('passes the config JSON straight through', async () => {
    await makeProgram().parseAsync([
      'node',
      'openbox',
      'aivss',
      'calculate',
      '--json',
      '{"base_security":{"attack_vector":1}}',
    ]);
    expect(mockClient.__calls[0].method).toBe('calculateAivss');
    expect(mockClient.__calls[0].args[0]).toEqual({
      base_security: { attack_vector: 1 },
    });
  });

  it('requires --json', async () => {
    await expect(
      makeProgram().parseAsync(['node', 'openbox', 'aivss', 'calculate']),
    ).rejects.toThrow();
  });
});
