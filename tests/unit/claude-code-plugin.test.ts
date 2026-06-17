import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  claudeCodeRuntimeConfigDir,
  exportClaudeCodePlugin,
  installClaudeCodePlugin,
  uninstallClaudeCodePlugin,
  verifyClaudeCodePlugin,
} from '../../ts/src/runtime/claude-code/plugin.js';

const temps: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openbox-claude-code-plugin-'));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('Claude Code plugin asset', () => {
  it('exports a complete marketplace-ready plugin folder', () => {
    const out = path.join(tempDir(), 'openbox');
    exportClaudeCodePlugin({
      out,
      matchers: {
        PreToolUse: '\\b(rm|sudo)\\b',
      },
    });

    expect(fs.existsSync(path.join(out, '.claude-plugin', 'plugin.json'))).toBe(true);
    expect(fs.existsSync(path.join(out, '.claude-plugin', 'marketplace.json'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'skills', 'openbox', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'diagnostics', 'component-inventory.json'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'diagnostics', 'claude-code-governance.json'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'diagnostics', 'monitors.opt-in.json'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'bin', 'openbox-cli.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'bin', 'openbox-plugin-doctor'))).toBe(true);
    expect(fs.readdirSync(path.join(out, 'commands')).sort()).toEqual([
      'openbox-check.md',
      'openbox-doctor.md',
      'openbox-list-agents.md',
      'openbox-pending.md',
      'openbox-status.md',
    ]);
    expect(fs.readdirSync(path.join(out, 'agents'))).toEqual(['openbox-reviewer.md']);

    const manifest = JSON.parse(fs.readFileSync(path.join(out, '.claude-plugin', 'plugin.json'), 'utf-8'));
    expect(manifest.name).toBe('openbox');
    expect(manifest.hooks).toBeUndefined();
    expect(manifest.mcpServers).toBeUndefined();
    expect(manifest.agents).toBeUndefined();

    const marketplace = JSON.parse(
      fs.readFileSync(path.join(out, '.claude-plugin', 'marketplace.json'), 'utf-8'),
    );
    expect(marketplace.description).toContain('Claude Code');
    expect(marketplace.plugins[0].source).toBe('./');

    const hooks = JSON.parse(fs.readFileSync(path.join(out, 'hooks', 'hooks.json'), 'utf-8'));
    expect(hooks.hooks.PreToolUse[0].matcher).toBe('\\b(rm|sudo)\\b');
    expect(hooks.hooks.PreToolUse[0].hooks[0]).toEqual({
      type: 'command',
      command: 'node',
      args: ['${CLAUDE_PLUGIN_ROOT}/bin/openbox-cli.mjs', 'claude-code', 'hook'],
      timeout: 86400,
    });

    const mcp = JSON.parse(fs.readFileSync(path.join(out, '.mcp.json'), 'utf-8'));
    expect(mcp.mcpServers.openbox).toEqual({
      command: 'node',
      args: ['${CLAUDE_PLUGIN_ROOT}/bin/openbox-cli.mjs', 'mcp', 'serve'],
    });

    const inventory = JSON.parse(
      fs.readFileSync(path.join(out, 'diagnostics', 'component-inventory.json'), 'utf-8'),
    );
    expect(inventory.components.skill.path).toBe('skills/openbox/SKILL.md');
    expect(inventory.components.hooks.defaultEvents).toContain('PreToolUse');
    expect(inventory.components.hooks.defaultEvents).toContain('Elicitation');
    expect(inventory.components.hooks.optInEvents).toContain('WorktreeCreate');
    expect(inventory.components.hooks.optInEvents).toContain('SessionEnd');
    expect(inventory.components.bin.files).toContain('openbox-cli.mjs');
    expect(inventory.components.settings.status).toBe('diagnose_only');
    expect(inventory.components.settings.emitted).toBe(false);
    expect(inventory.components.monitors.activeByDefault).toBe(false);
    expect(inventory.components.lsp.status).toBe('not_included');

    const governance = JSON.parse(
      fs.readFileSync(path.join(out, 'diagnostics', 'claude-code-governance.json'), 'utf-8'),
    );
    expect(governance.sdkCapabilities.some(
      (entry: any) => entry.capability === 'workflow lifecycle failure',
    )).toBe(true);
    expect(governance.sdkCapabilities.some(
      (entry: any) => entry.capability === 'guardrail transforms and constrain verdicts',
    )).toBe(true);

    const checks = verifyClaudeCodePlugin({ target: out });
    expect(checks.every((check) => check.status === 'pass')).toBe(true);

    const validation = spawnSync('claude', ['plugin', 'validate', out], {
      encoding: 'utf-8',
      timeout: 15_000,
    });
    const validatorUnavailable =
      validation.error ||
      /unknown command|invalid command|not found|no such command/i.test(
        `${validation.stderr}\n${validation.stdout}`,
      );
    if (!validatorUnavailable) {
      expect(validation.status, validation.stderr || validation.stdout).toBe(0);
    }
  });

  it('installs by symlink and uninstalls the local plugin target', () => {
    const source = path.join(tempDir(), 'source');
    const cwd = tempDir();
    const target = path.join(cwd, '.claude', 'skills', 'openbox');
    exportClaudeCodePlugin({ out: source });

    installClaudeCodePlugin({ scope: 'project', cwd, target, symlink: source });
    expect(fs.lstatSync(target).isSymbolicLink()).toBe(true);
    expect(verifyClaudeCodePlugin({ target }).every((check) => check.status === 'pass')).toBe(true);
    expect(fs.existsSync(path.join(claudeCodeRuntimeConfigDir(cwd), 'config.json'))).toBe(true);

    uninstallClaudeCodePlugin({ cwd, target });
    expect(fs.existsSync(target)).toBe(false);
  });

  it('validates explicitly opt-in hook exports only when requested', () => {
    const out = path.join(tempDir(), 'openbox-opt-in');
    exportClaudeCodePlugin({ out, includeOptInHooks: true });

    const defaultChecks = verifyClaudeCodePlugin({ target: out });
    expect(defaultChecks.some((check) => check.status === 'fail')).toBe(true);

    const optInChecks = verifyClaudeCodePlugin({ target: out, includeOptInHooks: true });
    expect(optInChecks.every((check) => check.status === 'pass')).toBe(true);
  });

  it('rejects install targets outside the project', () => {
    const cwd = tempDir();

    expect(() => installClaudeCodePlugin({ cwd, target: path.join(tempDir(), 'outside') })).toThrow(
      'Claude Code plugin install target must be inside the project',
    );
  });

  it('reports missing plugin assets and rejects unsafe output paths', () => {
    const missing = path.join(tempDir(), 'missing-plugin');
    const checks = verifyClaudeCodePlugin({ target: missing });

    expect(checks.some((check) => check.name === 'plugin' && check.status === 'fail')).toBe(true);
    expect(checks.some((check) => check.name === 'plugin-hooks' && check.status === 'fail')).toBe(true);
    expect(() => exportClaudeCodePlugin({ out: os.homedir() })).toThrow(
      'Refusing to overwrite unsafe Claude Code plugin path',
    );
  });
});
