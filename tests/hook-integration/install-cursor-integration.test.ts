// End-to-end install/uninstall against a throwaway HOME. Drives the
// real CLI binary (dist/cli/index.js) so the test exercises the same
// code path users hit, including the spec-emitted hook writer and
// the bundle copy helpers.
//
// OPENBOX_SKIP_EXTENSION=1 short-circuits the VS Code / Cursor
// extension install so the test doesn't need a real editor on PATH.
// Everything else (hooks, MCP, slash commands, rules, agents, skill)
// runs end-to-end.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const CLI = resolve(__dirname, '../../dist/cli/index.js');

let HOME: string;

function runCLI(args: string[]): { status: number | null; out: string; err: string } {
  const r = spawnSync('node', [CLI, ...args], {
    env: {
      ...process.env,
      HOME,
      OPENBOX_SKIP_EXTENSION: '1',
      OPENBOX_CONSENT: 'yes', // for any consent prompts in non-TTY
    },
    encoding: 'utf-8',
  });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

beforeAll(() => {
  if (!existsSync(CLI)) {
    throw new Error(`CLI not built. Run \`npm run build:bundle\` first. Looked for ${CLI}`);
  }
  HOME = mkdtempSync(join(tmpdir(), 'openbox-install-itest-'));
});

afterAll(() => {
  if (HOME) rmSync(HOME, { recursive: true, force: true });
});

describe('openbox install cursor; full bundle into a throwaway HOME', () => {
  it('lays down hooks, MCP, slash commands, rules, agents, and the skill', () => {
    const r = runCLI(['install', 'cursor', '--no-harden']);
    expect(r.status, r.err).toBe(0);

    // 1. Hooks file with every Cursor event under the cursor-keyed
    // shape. Hooks file write-order is implementation detail (the
    // writer iterates the spec but JSON.stringify preserves insertion
    // order which can differ on merge); assert as a set instead.
    const hooks = JSON.parse(readFileSync(join(HOME, '.cursor', 'hooks.json'), 'utf-8'));
    const eventNames = new Set(Object.keys(hooks.hooks));
    expect(eventNames).toEqual(new Set([
      'beforeSubmitPrompt',
      'beforeReadFile',
      'beforeShellExecution',
      'beforeMCPExecution',
      'preToolUse',
      'afterAgentResponse',
      'afterAgentThought',
      'afterShellExecution',
      'afterFileEdit',
      'afterMCPExecution',
      'postToolUse',
      'postToolUseFailure',
      'sessionStart',
      'stop',
      'beforeTabFileRead',
      'afterTabFileEdit',
      'sessionEnd',
      'preCompact',
      'subagentStart',
      'subagentStop',
    ]));

    // Each event entry is the new array shape `[{command, ...}]`,
    // never the legacy `{command}` object.
    for (const evt of Object.keys(hooks.hooks)) {
      expect(Array.isArray(hooks.hooks[evt]), evt).toBe(true);
      expect(hooks.hooks[evt][0]).toHaveProperty('command');
    }

    // 2. MCP entry
    const mcp = JSON.parse(readFileSync(join(HOME, '.cursor', 'mcp.json'), 'utf-8'));
    expect(mcp.mcpServers.openbox).toBeDefined();
    expect(mcp.mcpServers.openbox.command).toBe('openbox');
    expect(mcp.mcpServers.openbox.args).toContain('mcp');
    expect(mcp.mcpServers.openbox.args).toContain('serve');

    // 3. Slash commands
    const cmds = readdirSync(join(HOME, '.cursor', 'commands')).sort();
    expect(cmds).toEqual([
      'openbox-check.md',
      'openbox-doctor.md',
      'openbox-list-agents.md',
      'openbox-pending.md',
      'openbox-status.md',
    ]);

    // 4. Project rule
    const rules = readdirSync(join(HOME, '.cursor', 'rules'));
    expect(rules).toEqual(['openbox.mdc']);
    expect(readFileSync(join(HOME, '.cursor', 'rules', 'openbox.mdc'), 'utf-8'))
      .toMatch(/alwaysApply:\s*true/);

    // 5. Plugin agent
    const agents = readdirSync(join(HOME, '.cursor', 'agents'));
    expect(agents).toEqual(['openbox-reviewer.md']);

    // 6. Skill mirror
    expect(existsSync(join(HOME, '.cursor', 'skills', 'openbox', 'SKILL.md'))).toBe(true);
  });

  it('uninstall strips every OpenBox surface but leaves the host config files in place', () => {
    const r = runCLI(['uninstall', 'cursor']);
    expect(r.status, r.err).toBe(0);

    // hooks.json; file remains (might have other consumer keys), but
    // the OpenBox-managed hooks are gone. In our throwaway HOME the
    // result is `{}`.
    const hooks = JSON.parse(readFileSync(join(HOME, '.cursor', 'hooks.json'), 'utf-8'));
    expect(hooks).toEqual({});

    // mcp.json; same: openbox key removed.
    const mcp = JSON.parse(readFileSync(join(HOME, '.cursor', 'mcp.json'), 'utf-8'));
    expect(mcp.mcpServers?.openbox).toBeUndefined();

    // Bundle dirs may be empty but shouldn't contain OpenBox files.
    expect(readdirSync(join(HOME, '.cursor', 'commands'))).toEqual([]);
    expect(readdirSync(join(HOME, '.cursor', 'rules'))).toEqual([]);
    expect(readdirSync(join(HOME, '.cursor', 'agents'))).toEqual([]);
    expect(existsSync(join(HOME, '.cursor', 'skills', 'openbox'))).toBe(false);
  });
});
