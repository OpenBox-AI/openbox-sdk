// Install / uninstall coverage for the Claude Code plugin surface.
// The stable CLI no longer writes Claude settings directly. It
// installs a skills-dir plugin containing .claude-plugin metadata,
// hooks, MCP config, slash commands, an agent template, and the
// OpenBox skill. The hook runtime still reads .claude-hooks/config.json,
// so plugin install also seeds that config template.

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DIST_CLI = path.resolve(import.meta.dirname, '../../dist/cli/index.js');
const OPENBOX =
  process.env.OPENBOX_CLI && existsSync(process.env.OPENBOX_CLI)
    ? process.env.OPENBOX_CLI
    : DIST_CLI;

function runCli(args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(OPENBOX, args, {
    cwd,
    encoding: 'utf-8',
    timeout: 15_000,
    env: process.env,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function pluginDir(project: string): string {
  return path.join(project, '.claude', 'skills', 'openbox');
}

function expectClaudePlugin(project: string): void {
  const root = pluginDir(project);
  expect(existsSync(path.join(root, '.claude-plugin', 'plugin.json'))).toBe(true);
  expect(existsSync(path.join(root, '.claude-plugin', 'marketplace.json'))).toBe(true);
  expect(existsSync(path.join(root, '.mcp.json'))).toBe(true);
  expect(existsSync(path.join(root, 'skills', 'openbox', 'SKILL.md'))).toBe(true);
  expect(existsSync(path.join(root, 'commands', 'openbox-status.md'))).toBe(true);
  expect(existsSync(path.join(root, 'commands', 'openbox-doctor.md'))).toBe(true);
  expect(existsSync(path.join(root, 'agents', 'openbox-reviewer.md'))).toBe(true);
  expect(existsSync(path.join(root, 'bin', 'openbox-cli.mjs'))).toBe(true);
  expect(existsSync(path.join(root, 'bin', 'openbox-plugin-doctor'))).toBe(true);
  expect(existsSync(path.join(project, '.claude-hooks', 'config.json'))).toBe(true);
  expect(existsSync(path.join(project, '.claude', 'settings.json'))).toBe(false);

  const inventory = JSON.parse(
    readFileSync(path.join(root, 'diagnostics', 'component-inventory.json'), 'utf-8'),
  );
  expect(inventory.components.settings.status).toBe('diagnose_only');
  expect(inventory.components.monitors.activeByDefault).toBe(false);
  expect(inventory.components.lsp.status).toBe('not_included');
}

function readHooks(project: string): Record<string, Array<{ matcher?: string; hooks: Array<{ args?: string[]; command: string; type: string; timeout?: number }> }>> {
  return JSON.parse(readFileSync(path.join(pluginDir(project), 'hooks', 'hooks.json'), 'utf-8')).hooks;
}

describe('claude-code plugin install / uninstall', () => {
  it('claude-code plugin install --scope project writes a complete native plugin folder', () => {
    const project = mkdtempSync(path.join(tmpdir(), 'obx-cc-plugin-'));

    const r = runCli(
      ['claude-code', 'plugin', 'install', '--scope', 'project', '--cwd', project],
      project,
    );
    expect(r.status, `install failed: ${r.stderr}`).toBe(0);
    expectClaudePlugin(project);

    const hooks = readHooks(project);
    const expectedEvents = [
      'PreToolUse',
      'PostToolUse',
      'UserPromptSubmit',
      'PermissionRequest',
      'PreCompact',
      'SessionStart',
      'SubagentStart',
      'SubagentStop',
      'Stop',
      'Notification',
    ];
    for (const event of expectedEvents) {
      expect(hooks[event], `hooks.${event} not installed`).toBeDefined();
      const hookEntry = hooks[event][0]?.hooks?.[0];
      expect(hookEntry?.command).toBe('node');
      expect(hookEntry?.args).toEqual([
        '${CLAUDE_PLUGIN_ROOT}/bin/openbox-cli.mjs',
        'claude-code',
        'hook',
      ]);
      expect(hookEntry?.type).toBe('command');
    }
    expect(hooks.SessionEnd, 'SessionEnd is opt-in because Claude Code cancels shutdown hooks').toBeUndefined();
    expect(hooks.WorktreeCreate, 'WorktreeCreate is diagnostic-only because it replaces default git behavior').toBeUndefined();

    const doctor = runCli(
      ['claude-code', 'doctor', '--cwd', project, '--surface-only', '--json'],
      project,
    );
    expect(doctor.status, `doctor failed: ${doctor.stderr}`).toBe(0);
    const payload = JSON.parse(doctor.stdout);
    expect(payload.summary.fail).toBe(0);
    expect(payload.runtimeReadiness.projectScoped).toBe(true);
    expect(payload.claudeCodeGovernance.hookCount).toBe(30);

    for (const event of ['PreToolUse', 'UserPromptSubmit', 'PermissionRequest']) {
      const timeout = hooks[event][0]?.hooks?.[0]?.timeout;
      expect(timeout, `${event} timeout missing or too short`).toBeGreaterThanOrEqual(300);
    }
  });

  it('top-level install claude-code uses the same plugin path', () => {
    const project = mkdtempSync(path.join(tmpdir(), 'obx-cc-top-install-'));

    const install = runCli(
      ['install', 'claude-code', '--scope', 'project', '--cwd', project],
      project,
    );
    expect(install.status, `install failed: ${install.stderr}`).toBe(0);
    expectClaudePlugin(project);

    const uninstall = runCli(
      ['uninstall', 'claude-code', '--scope', 'project', '--cwd', project],
      project,
    );
    expect(uninstall.status, `uninstall failed: ${uninstall.stderr}`).toBe(0);
    expect(existsSync(pluginDir(project))).toBe(false);
  });

  it('uninstall removes only the plugin folder and leaves unrelated settings alone', () => {
    const project = mkdtempSync(path.join(tmpdir(), 'obx-cc-uninstall-'));
    const settingsPath = path.join(project, '.claude', 'settings.json');
    spawnSync('mkdir', ['-p', path.dirname(settingsPath)], { cwd: project });
    writeFileSync(settingsPath, JSON.stringify({ unrelated: { keep: 'me' } }, null, 2));

    const install = runCli(
      ['claude-code', 'plugin', 'install', '--scope', 'project', '--cwd', project],
      project,
    );
    expect(install.status).toBe(0);

    const uninstall = runCli(
      ['claude-code', 'plugin', 'uninstall', '--scope', 'project', '--cwd', project],
      project,
    );
    expect(uninstall.status, `uninstall failed: ${uninstall.stderr}`).toBe(0);
    expect(existsSync(pluginDir(project))).toBe(false);

    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as {
      unrelated?: { keep?: string };
    };
    expect(settings.unrelated?.keep).toBe('me');
  });

  it('install copies configured hook matchers into plugin hooks.json', () => {
    const project = mkdtempSync(path.join(tmpdir(), 'obx-cc-matcher-'));

    const r = runCli(
      [
        'claude-code',
        'plugin',
        'install',
        '--scope',
        'project',
        '--cwd',
        project,
        '--matcher',
        'PreToolUse=Bash|Write',
      ],
      project,
    );
    expect(r.status, `install failed: ${r.stderr}`).toBe(0);
    const hooks = readHooks(project);
    expect(hooks.PreToolUse[0].matcher).toBe('Bash|Write');
  });

  it('install removes stale project settings hooks that invoke a global openbox binary', () => {
    const project = mkdtempSync(path.join(tmpdir(), 'obx-cc-stale-settings-'));
    const settingsPath = path.join(project, '.claude', 'settings.json');
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          hooks: {
            UserPromptSubmit: [
              {
                hooks: [
                  { type: 'command', command: 'openbox claude-code hook' },
                  { type: 'command', command: 'node', args: ['project-hook.mjs'] },
                ],
              },
            ],
            Stop: [
              {
                hooks: [
                  { type: 'command', command: 'openbox claude-code hook' },
                ],
              },
            ],
          },
          unrelated: { keep: true },
        },
        null,
        2,
      ),
    );

    const install = runCli(
      ['claude-code', 'plugin', 'install', '--scope', 'project', '--cwd', project],
      project,
    );
    expect(install.status, `install failed: ${install.stderr}`).toBe(0);

    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as {
      hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
      unrelated?: { keep?: boolean };
    };
    expect(JSON.stringify(settings)).not.toContain('openbox claude-code hook');
    expect(settings.unrelated?.keep).toBe(true);
    expect(settings.hooks?.UserPromptSubmit?.[0]?.hooks?.[0]).toMatchObject({
      command: 'node',
      args: ['project-hook.mjs'],
    });
    expect(settings.hooks?.Stop).toBeUndefined();
  });

  it('install deletes a project settings file that only contained stale OpenBox hooks', () => {
    const project = mkdtempSync(path.join(tmpdir(), 'obx-cc-stale-only-'));
    const settingsPath = path.join(project, '.claude', 'settings.json');
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          hooks: {
            Stop: [
              {
                hooks: [
                  { type: 'command', command: 'openbox claude-code hook' },
                ],
              },
            ],
          },
        },
        null,
        2,
      ),
    );

    const install = runCli(
      ['claude-code', 'plugin', 'install', '--scope', 'project', '--cwd', project],
      project,
    );
    expect(install.status, `install failed: ${install.stderr}`).toBe(0);
    expect(existsSync(settingsPath)).toBe(false);
  });

  it('install removes stale project MCP entry that invokes a global openbox binary', () => {
    const project = mkdtempSync(path.join(tmpdir(), 'obx-cc-stale-mcp-'));
    const mcpPath = path.join(project, '.mcp.json');
    writeFileSync(
      mcpPath,
      JSON.stringify(
        {
          mcpServers: {
            openbox: { command: 'openbox', args: ['mcp', 'serve'] },
            keep: { command: 'node', args: ['keep.mjs'] },
          },
        },
        null,
        2,
      ),
    );

    const install = runCli(
      ['claude-code', 'plugin', 'install', '--scope', 'project', '--cwd', project],
      project,
    );
    expect(install.status, `install failed: ${install.stderr}`).toBe(0);

    const mcp = JSON.parse(readFileSync(mcpPath, 'utf-8')) as {
      mcpServers?: Record<string, { command?: string; args?: string[] }>;
    };
    expect(mcp.mcpServers?.openbox).toBeUndefined();
    expect(mcp.mcpServers?.keep).toEqual({
      command: 'node',
      args: ['keep.mjs'],
    });
  });

  it('install deletes a project MCP file that only contained the stale OpenBox entry', () => {
    const project = mkdtempSync(path.join(tmpdir(), 'obx-cc-stale-mcp-only-'));
    const mcpPath = path.join(project, '.mcp.json');
    writeFileSync(
      mcpPath,
      JSON.stringify(
        {
          mcpServers: {
            openbox: { command: 'openbox', args: ['mcp', 'serve'] },
          },
        },
        null,
        2,
      ),
    );

    const install = runCli(
      ['claude-code', 'plugin', 'install', '--scope', 'project', '--cwd', project],
      project,
    );
    expect(install.status, `install failed: ${install.stderr}`).toBe(0);
    expect(existsSync(mcpPath)).toBe(false);
  });
});
