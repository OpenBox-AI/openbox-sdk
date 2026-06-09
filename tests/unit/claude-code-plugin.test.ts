import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
      command: 'openbox claude-code hook',
      timeout: 86400,
    });

    const mcp = JSON.parse(fs.readFileSync(path.join(out, '.mcp.json'), 'utf-8'));
    expect(mcp.mcpServers.openbox).toEqual({ command: 'openbox', args: ['mcp', 'serve'] });

    const checks = verifyClaudeCodePlugin({ target: out });
    expect(checks.every((check) => check.status === 'pass')).toBe(true);
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

  it('rejects install targets outside the project', () => {
    const cwd = tempDir();

    expect(() => installClaudeCodePlugin({ cwd, target: path.join(tempDir(), 'outside') })).toThrow(
      'Claude Code plugin install target must be inside the project',
    );
  });
});
