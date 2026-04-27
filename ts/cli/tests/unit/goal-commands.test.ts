// Unit tests for `goal update` - validates the four-fields-required rule
// plus enum/int validation and the --json escape hatch.

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

import { registerGoalCommands } from '../../src/commands/goal.js';

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerGoalCommands(program);
  return program;
}

beforeEach(() => {
  mockClient.__calls.length = 0;
  mockClient.__responses.updateGoalAlignment = { ok: true };
});

describe('goal update', () => {
  const full = [
    '--threshold',
    '80',
    '--action',
    'alert_only',
    '--frequency',
    'every_action',
    '--model',
    'gpt-4o',
  ];

  it('sends all four fields with correct casing', async () => {
    await makeProgram().parseAsync([
      'node',
      'openbox',
      'goal',
      'update',
      'agent-1',
      ...full,
    ]);
    expect(mockClient.__calls).toHaveLength(1);
    expect(mockClient.__calls[0].method).toBe('updateGoalAlignment');
    expect(mockClient.__calls[0].args[1]).toEqual({
      alignment_threshold: 80,
      drift_detection_action: 'alert_only',
      evaluation_frequency: 'every_action',
      llama_firewall_model: 'gpt-4o',
    });
  });

  it('fails fast when any required field is missing (no backend call)', async () => {
    const partial = [
      '--threshold',
      '80',
      '--action',
      'alert_only',
      '--frequency',
      'every_action',
      // --model omitted
    ];
    try {
      await makeProgram().parseAsync([
        'node',
        'openbox',
        'goal',
        'update',
        'agent-1',
        ...partial,
      ]);
      expect.fail('expected exit');
    } catch {
      // exitOverride throws on process.exit
    }
    expect(mockClient.__calls).toHaveLength(0);
  });

  it('rejects invalid --action enum without hitting backend', async () => {
    const bad = [
      '--threshold',
      '80',
      '--action',
      'nope',
      '--frequency',
      'every_action',
      '--model',
      'gpt-4o',
    ];
    await expect(
      makeProgram().parseAsync(['node', 'openbox', 'goal', 'update', 'agent-1', ...bad]),
    ).rejects.toThrow();
    expect(mockClient.__calls).toHaveLength(0);
  });

  it('rejects non-integer --threshold', async () => {
    const bad = [
      '--threshold',
      'big',
      '--action',
      'alert_only',
      '--frequency',
      'every_action',
      '--model',
      'gpt-4o',
    ];
    await expect(
      makeProgram().parseAsync(['node', 'openbox', 'goal', 'update', 'agent-1', ...bad]),
    ).rejects.toThrow();
  });

  it('--json bypasses the four-field requirement and passes body through', async () => {
    await makeProgram().parseAsync([
      'node',
      'openbox',
      'goal',
      'update',
      'agent-1',
      '--json',
      '{"alignment_threshold":50,"custom":"x"}',
    ]);
    expect(mockClient.__calls[0].args[1]).toEqual({
      alignment_threshold: 50,
      custom: 'x',
    });
  });
});
