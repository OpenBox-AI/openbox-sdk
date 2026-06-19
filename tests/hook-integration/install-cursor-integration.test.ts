// End-to-end install/uninstall against a throwaway HOME. Drives the
// real CLI entrypoint so the test exercises the same code path users hit:
// project-local plugin-first Cursor install.
//
// Everything (plugin manifest, hooks, MCP, slash commands, rules,
// agents, skill) runs end-to-end without writing host-level Cursor files.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { requireOpenBoxCli } from '../helpers/openbox-cli.js';

const CLI = requireOpenBoxCli();

let HOME: string;
let PROJECT: string;

function runCLI(args: string[]): { status: number | null; out: string; err: string } {
  const r = spawnSync(CLI, args, {
    cwd: PROJECT,
    env: {
      ...process.env,
      HOME,
    },
    encoding: 'utf-8',
  });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

beforeAll(() => {
  if (!existsSync(CLI)) {
    throw new Error(`CLI entrypoint not found at ${CLI}`);
  }
  HOME = mkdtempSync(join(tmpdir(), 'openbox-install-itest-'));
  PROJECT = mkdtempSync(join(tmpdir(), 'openbox-install-project-'));
});

afterAll(() => {
  if (HOME) rmSync(HOME, { recursive: true, force: true });
  if (PROJECT) rmSync(PROJECT, { recursive: true, force: true });
});

describe('openbox install cursor; project-local plugin bundle', () => {
  it('lays down the project-local plugin surface', () => {
    const r = runCLI(['install', 'cursor']);
    expect(r.status, r.err).toBe(0);

    const plugin = join(PROJECT, '.cursor', 'plugins', 'local', 'openbox');
    expect(existsSync(join(plugin, '.cursor-plugin', 'plugin.json'))).toBe(true);
    expect(existsSync(join(plugin, '.cursor-plugin', 'marketplace.json'))).toBe(true);

    // 1. Plugin hooks file with every Cursor event under the cursor-keyed
    // shape. Hooks file write-order is implementation detail (the
    // writer iterates the spec but JSON.stringify preserves insertion
    // order which can differ on merge); assert as a set instead.
    const hooks = JSON.parse(readFileSync(join(plugin, 'hooks', 'hooks.json'), 'utf-8'));
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
    const mcp = JSON.parse(readFileSync(join(plugin, 'mcp.json'), 'utf-8'));
    expect(mcp.mcpServers.openbox).toBeDefined();
    expect(mcp.mcpServers.openbox.command).toBe('openbox');
    expect(mcp.mcpServers.openbox.args).toContain('mcp');
    expect(mcp.mcpServers.openbox.args).toContain('serve');

    // 3. Slash commands
    const cmds = readdirSync(join(plugin, 'commands')).sort();
    expect(cmds).toEqual([
      'openbox-check.md',
      'openbox-doctor.md',
      'openbox-list-agents.md',
      'openbox-pending.md',
      'openbox-status.md',
    ]);

    // 4. Project rule
    const rules = readdirSync(join(plugin, 'rules'));
    expect(rules).toEqual(['openbox.mdc']);
    expect(readFileSync(join(plugin, 'rules', 'openbox.mdc'), 'utf-8'))
      .toMatch(/alwaysApply:\s*true/);

    // 5. Plugin agent
    const agents = readdirSync(join(plugin, 'agents'));
    expect(agents).toEqual(['openbox-reviewer.md']);

    // 6. Skill mirror
    expect(existsSync(join(plugin, 'skills', 'openbox', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(PROJECT, '.cursor-hooks', 'config.json'))).toBe(true);

    expect(existsSync(join(HOME, '.cursor', 'plugins', 'local', 'openbox'))).toBe(false);
    expect(existsSync(join(HOME, '.cursor', 'hooks.json'))).toBe(false);
    expect(existsSync(join(HOME, '.cursor', 'mcp.json'))).toBe(false);
  });

  it('cursor doctor verifies the plugin surface as JSON', () => {
    const r = runCLI(['cursor', 'doctor', '--json', '--surface-only']);
    expect(r.status, r.err).toBe(0);
    const payload = JSON.parse(r.out);
    expect(payload.summary).toEqual({ pass: 10, skip: 0, fail: 0 });
    expect(payload.checks.map((c: any) => c.name)).toEqual([
      'plugin',
      'plugin-manifest',
      'plugin-marketplace',
      'plugin-workspace-open',
      'plugin-skill',
      'plugin-commands',
      'plugin-rules',
      'plugin-agents',
      'plugin-hooks',
      'plugin-mcp',
    ]);
  });

  it('built CLI exports a complete plugin folder from dist assets', () => {
    const out = join(HOME, 'manual-export', 'openbox');
    const r = runCLI(['cursor', 'plugin', 'export', '--out', out]);
    expect(r.status, r.err).toBe(0);
    expect(existsSync(join(out, '.cursor-plugin', 'plugin.json'))).toBe(true);
    expect(existsSync(join(out, 'workspaceOpen.json'))).toBe(true);
    expect(existsSync(join(out, 'hooks', 'hooks.json'))).toBe(true);
    expect(existsSync(join(out, 'mcp.json'))).toBe(true);
    expect(existsSync(join(out, 'skills', 'openbox', 'SKILL.md'))).toBe(true);
    expect(readdirSync(join(out, 'commands')).sort()).toEqual([
      'openbox-check.md',
      'openbox-doctor.md',
      'openbox-list-agents.md',
      'openbox-pending.md',
      'openbox-status.md',
    ]);
  });

  it('uninstall strips the project-local plugin', () => {
    const r = runCLI(['uninstall', 'cursor']);
    expect(r.status, r.err).toBe(0);

    expect(existsSync(join(PROJECT, '.cursor', 'plugins', 'local', 'openbox'))).toBe(false);
  });

  it('does not expose old direct Cursor install flags', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'openbox-cursor-project-'));
    try {
      const install = runCLI(['install', 'cursor', '--scope', 'project', '--cwd', workspace]);
      expect(install.status).not.toBe(0);
      expect(existsSync(join(workspace, '.cursor', 'hooks.json'))).toBe(false);
      expect(existsSync(join(workspace, '.cursor', 'mcp.json'))).toBe(false);

      const doctor = runCLI([
        'cursor',
        'doctor',
        '--scope',
        'project',
        '--cwd',
        workspace,
        '--json',
        '--surface-only',
      ]);
      expect(doctor.status).not.toBe(0);

      const uninstall = runCLI(['uninstall', 'cursor', '--scope', 'project', '--cwd', workspace]);
      expect(uninstall.status).not.toBe(0);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
