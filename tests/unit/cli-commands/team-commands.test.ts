// Command-level unit tests for `team create / delete / add-members /
// remove-members`. Stubs the real OpenBoxClient via vi.mock on '../config.js'
// so the action runs end-to-end through Commander arg parsing, flag merging,
// and DTO construction - without any network. Asserts that the right client
// method is invoked with the right body shape.
//
// This is the template the other destructive-command unit tests should
// follow: auth-logout, goal-update, member-invite, api-key, approval-decide,
// aivss-recalculate. Copy the mock setup, swap the registerX import, and
// assert the mock calls.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { makeMockClient, type MockClient } from '../../helpers/cli/mock-client.js';

// Stub the config module BEFORE the command module imports it. vi.mock is
// hoisted to the top of the file by vitest, so this runs before any import
// below dereferences getClient().
const mockClient: MockClient = makeMockClient();

vi.mock('../../../ts/src/cli/config.js', async () => {
  // Keep the real type exports so TypeScript-checked imports inside the
  // command modules still resolve; only swap the runtime functions the
  // actions actually call.
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../ts/src/cli/config.js',
  );
  return {
    ...actual,
    getClient: () => mockClient,
  };
});

// Import AFTER the mock is registered.
import { registerTeamCommands } from '../../../ts/src/cli/commands/team.js';

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride(); // throw on process.exit so we can catch validator errors
  registerTeamCommands(program);
  return program;
}

beforeEach(() => {
  mockClient.__calls.length = 0;
  // Default success responses for each team endpoint.
  mockClient.__responses.createTeam = { id: 'team-new' };
  mockClient.__responses.deleteTeams = { status: 200 };
  mockClient.__responses.addTeamMembers = { status: 200 };
  mockClient.__responses.removeTeamMembers = { status: 200 };
});

describe('team create', () => {
  it('posts { name, description, icon } from flags', async () => {
    await makeProgram().parseAsync([
      'node',
      'openbox',
      'team',
      'create',
      'org-1',
      '--name',
      'Finance',
      '--desc',
      'money folks',
      '--icon',
      'https://example.com/f.png',
    ]);
    expect(mockClient.__calls).toHaveLength(1);
    expect(mockClient.__calls[0].method).toBe('createTeam');
    expect(mockClient.__calls[0].args[0]).toBe('org-1');
    expect(mockClient.__calls[0].args[1]).toEqual({
      name: 'Finance',
      description: 'money folks',
      icon: 'https://example.com/f.png',
    });
  });

  it('rejects when neither --name nor --icon is given', async () => {
    await expect(
      makeProgram().parseAsync(['node', 'openbox', 'team', 'create', 'org-1']),
    ).rejects.toThrow();
    expect(mockClient.__calls).toHaveLength(0);
  });

  it('passes through --json body as-is', async () => {
    await makeProgram().parseAsync([
      'node',
      'openbox',
      'team',
      'create',
      'org-1',
      '--json',
      '{"name":"Legal","custom_field":true}',
    ]);
    expect(mockClient.__calls[0].args[1]).toEqual({
      name: 'Legal',
      custom_field: true,
    });
  });
});

describe('team delete', () => {
  it('accepts variadic --ids and posts { ids: [...] }', async () => {
    await makeProgram().parseAsync([
      'node',
      'openbox',
      'team',
      'delete',
      'org-1',
      '--ids',
      't-1',
      't-2',
      't-3',
    ]);
    expect(mockClient.__calls[0].method).toBe('deleteTeams');
    expect(mockClient.__calls[0].args[1]).toEqual({ ids: ['t-1', 't-2', 't-3'] });
  });

  it('rejects when --ids is omitted', async () => {
    await expect(
      makeProgram().parseAsync(['node', 'openbox', 'team', 'delete', 'org-1']),
    ).rejects.toThrow();
  });
});

describe('team add-members / remove-members', () => {
  it('add-members posts { user_ids: [...] }', async () => {
    await makeProgram().parseAsync([
      'node',
      'openbox',
      'team',
      'add-members',
      'org-1',
      'team-1',
      '--user-ids',
      'u-a',
      'u-b',
    ]);
    expect(mockClient.__calls[0].method).toBe('addTeamMembers');
    expect(mockClient.__calls[0].args[0]).toBe('org-1');
    expect(mockClient.__calls[0].args[1]).toBe('team-1');
    expect(mockClient.__calls[0].args[2]).toEqual({ user_ids: ['u-a', 'u-b'] });
  });

  it('remove-members hits the separate client method (not merged with add)', async () => {
    await makeProgram().parseAsync([
      'node',
      'openbox',
      'team',
      'remove-members',
      'org-1',
      'team-1',
      '--user-ids',
      'u-a',
    ]);
    expect(mockClient.__calls[0].method).toBe('removeTeamMembers');
  });
});
