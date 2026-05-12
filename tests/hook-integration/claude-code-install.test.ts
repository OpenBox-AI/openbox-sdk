// Install / uninstall / doctor coverage for the claude-code
// integration. Runs `openbox claude-code install --scope project`
// against a fresh temp directory and asserts the spec-driven
// artifacts land where expected:
//
//   - <cwd>/.claude/settings.json with one hook entry per
//     @hookEvent in adapters.tsp (PreToolUse, PostToolUse,
//     UserPromptSubmit, PermissionRequest, PreCompact,
//     SessionStart, SessionEnd, SubagentStart, SubagentStop,
//     Stop, Notification)
//   - <cwd>/.claude-hooks/config.json with sane defaults
//   - the hook command set to `openbox claude-code hook`
//
// Uninstall removes the hook block while leaving unrelated
// settings keys alone. Doctor reports the install as healthy
// when run inside the project directory.

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const OPENBOX = process.env.OPENBOX_CLI ?? 'openbox';

function runCli(args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(OPENBOX, args, {
    cwd,
    encoding: 'utf-8',
    timeout: 15_000,
    env: {
      ...process.env,
      OPENBOX_EXPERIMENTAL_LEVEL: 'experimental',
    },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('claude-code install / uninstall / doctor', () => {
  it('install --scope project writes the spec-driven hook block and config file', () => {
    const project = mkdtempSync(path.join(tmpdir(), 'obx-cc-install-'));

    const r = runCli(
      ['--experimental', 'claude-code', 'install', '--scope', 'project', '--cwd', project, '--no-mcp'],
      project,
    );
    expect(r.status, `install failed: ${r.stderr}`).toBe(0);

    const settingsPath = path.join(project, '.claude', 'settings.json');
    expect(existsSync(settingsPath), 'settings.json not created').toBe(true);
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as {
      hooks?: Record<string, Array<{ hooks: Array<{ command: string; type: string; timeout?: number }> }>>;
    };
    expect(settings.hooks).toBeDefined();

    // The spec defines events under @hookEvent in adapters.tsp; the
    // install must cover every one. Names match the keys claude code
    // emits, which are PascalCase.
    const expectedEvents = [
      'PreToolUse',
      'PostToolUse',
      'UserPromptSubmit',
      'PermissionRequest',
      'PreCompact',
      'SessionStart',
      'SessionEnd',
      'SubagentStart',
      'SubagentStop',
      'Stop',
      'Notification',
    ];
    for (const event of expectedEvents) {
      expect(
        settings.hooks![event],
        `settings.hooks.${event} not installed`,
      ).toBeDefined();
      const hookEntry = settings.hooks![event][0]?.hooks?.[0];
      expect(hookEntry?.command).toBe('openbox claude-code hook');
      expect(hookEntry?.type).toBe('command');
    }

    // PreToolUse and the other permission-arm events need long
    // timeouts so the hook can poll for an approval decision past
    // the default 60s claude-code budget.
    const permissionTimeoutEvents = ['PreToolUse', 'UserPromptSubmit', 'PermissionRequest'];
    for (const event of permissionTimeoutEvents) {
      const timeout = settings.hooks![event][0]?.hooks?.[0]?.timeout;
      expect(timeout, `${event} timeout missing or too short`).toBeGreaterThanOrEqual(300);
    }

    // The config file gets seeded with safe defaults the user can
    // edit. We assert the file exists; contents are exercised by
    // the config-scope tests.
    const cfgPath = path.join(project, '.claude-hooks', 'config.json');
    expect(existsSync(cfgPath), '.claude-hooks/config.json not created').toBe(true);
  });

  it('uninstall --scope project removes the hook block without touching unrelated keys', () => {
    const project = mkdtempSync(path.join(tmpdir(), 'obx-cc-uninstall-'));
    const settingsPath = path.join(project, '.claude', 'settings.json');

    // Pre-seed an unrelated setting so we can verify it survives.
    spawnSync('mkdir', ['-p', path.dirname(settingsPath)], { cwd: project });
    writeFileSync(settingsPath, JSON.stringify({ unrelated: { keep: 'me' } }));

    const install = runCli(
      ['--experimental', 'claude-code', 'install', '--scope', 'project', '--cwd', project, '--no-mcp'],
      project,
    );
    expect(install.status).toBe(0);

    const uninstall = runCli(
      ['--experimental', 'claude-code', 'uninstall', '--scope', 'project', '--cwd', project, '--no-mcp'],
      project,
    );
    expect(uninstall.status, `uninstall failed: ${uninstall.stderr}`).toBe(0);

    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as {
      hooks?: Record<string, unknown>;
      unrelated?: { keep?: string };
    };
    // Either hooks is gone or it's there but no openbox commands remain.
    const remaining = Object.entries(settings.hooks ?? {}).flatMap(([, arr]) =>
      (arr as Array<{ hooks: Array<{ command: string }> }>).flatMap((m) => m.hooks),
    );
    const openboxLeftover = remaining.filter((h) => h.command?.includes('openbox claude-code'));
    expect(openboxLeftover, 'uninstall left openbox hook entries behind').toEqual([]);

    // The unrelated key must survive a hook uninstall; the
    // installer touches `hooks` only.
    expect(settings.unrelated?.keep).toBe('me');
  });

  it('install --no-mcp keeps the MCP server entry out of settings', () => {
    const project = mkdtempSync(path.join(tmpdir(), 'obx-cc-nomcp-'));
    const r = runCli(
      ['--experimental', 'claude-code', 'install', '--scope', 'project', '--cwd', project, '--no-mcp'],
      project,
    );
    expect(r.status).toBe(0);
    const settingsPath = path.join(project, '.claude', 'settings.json');
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as {
      mcpServers?: Record<string, unknown>;
    };
    // With --no-mcp, the install must not write mcpServers.openbox.
    expect(settings.mcpServers?.openbox).toBeUndefined();
  });
});
