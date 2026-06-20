import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  exportCursorPlugin,
  installCursorRepoMode,
  installCursorPlugin,
  uninstallCursorRepoMode,
  uninstallCursorPlugin,
  verifyCursorRepoMode,
  verifyCursorPlugin,
} from '../../ts/src/runtime/cursor/plugin.js';
import { PROVIDER_PLUGIN_COMPONENTS } from '../../ts/src/governance/capability-matrix.js';

const temps: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openbox-cursor-plugin-'));
  temps.push(dir);
  return dir;
}

const CURSOR_COMPONENTS = PROVIDER_PLUGIN_COMPONENTS.find(
  (entry) => entry.provider === 'cursor',
)!.components;

function assertSpecComponentPathsExist(root: string): void {
  for (const component of CURSOR_COMPONENTS) {
    expect(component.path, `Cursor plugin component ${component.name} path`).toBeTruthy();
    expect(fs.existsSync(path.join(root, component.path!)), component.name).toBe(true);
  }
}

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('Cursor plugin asset', () => {
  it('exports a complete marketplace-ready plugin folder', () => {
    const out = path.join(tempDir(), 'openbox');
    exportCursorPlugin({
      out,
      matchers: {
        beforeShellExecution: '\\b(rm|sudo)\\b',
      },
    });

    assertSpecComponentPathsExist(out);
    expect(fs.existsSync(path.join(out, '.cursor-plugin', 'plugin.json'))).toBe(true);
    expect(fs.existsSync(path.join(out, '.cursor-plugin', 'marketplace.json'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'workspaceOpen.json'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'skills', 'openbox', 'SKILL.md'))).toBe(true);
    expect(fs.readdirSync(path.join(out, 'commands')).sort()).toEqual([
      'openbox-check.md',
      'openbox-doctor.md',
      'openbox-list-agents.md',
      'openbox-pending.md',
      'openbox-status.md',
    ]);
    expect(fs.readdirSync(path.join(out, 'rules'))).toEqual(['openbox.mdc']);
    expect(fs.readdirSync(path.join(out, 'agents'))).toEqual(['openbox-reviewer.md']);

    const hooks = JSON.parse(fs.readFileSync(path.join(out, 'hooks', 'hooks.json'), 'utf-8'));
    expect(hooks.hooks.beforeShellExecution[0].matcher).toBe('\\b(rm|sudo)\\b');
    expect(hooks.hooks.sessionEnd[0].command).toBe('openbox cursor hook');

    const mcp = JSON.parse(fs.readFileSync(path.join(out, 'mcp.json'), 'utf-8'));
    expect(mcp.mcpServers.openbox).toEqual({ command: 'openbox', args: ['mcp', 'serve'] });
    const workspaceOpen = JSON.parse(fs.readFileSync(path.join(out, 'workspaceOpen.json'), 'utf-8'));
    expect(workspaceOpen.workspaceOpen.plugins[0]).toMatchObject({
      name: 'openbox',
      path: '.cursor/plugins/local/openbox',
      activation: 'workspaceOpen',
    });

    const checks = verifyCursorPlugin({ target: out });
    expect(checks.every((check) => check.status === 'pass')).toBe(true);
  });

  it('installs by symlink and uninstalls the local plugin target', () => {
    const source = path.join(tempDir(), 'source');
    const cwd = tempDir();
    const target = path.join(cwd, '.cursor', 'plugins', 'local', 'openbox');
    exportCursorPlugin({ out: source });

    installCursorPlugin({ cwd, target, symlink: source });
    expect(fs.lstatSync(target).isSymbolicLink()).toBe(true);
    expect(verifyCursorPlugin({ target }).every((check) => check.status === 'pass')).toBe(true);
    expect(fs.existsSync(path.join(cwd, '.cursor-hooks', 'config.json'))).toBe(true);

    uninstallCursorPlugin({ cwd, target });
    expect(fs.existsSync(target)).toBe(false);
  });

  it('rejects install targets outside the project', () => {
    const source = path.join(tempDir(), 'source');
    const cwd = tempDir();
    exportCursorPlugin({ out: source });

    expect(() => installCursorPlugin({ cwd, target: path.join(tempDir(), 'outside') })).toThrow(
      'Cursor plugin install target must be inside the project',
    );
  });

  it('installs and uninstalls cloud-compatible repo mode files', () => {
    const cwd = tempDir();
    const root = installCursorRepoMode({
      cwd,
      matchers: {
        beforeShellExecution: '\\b(rm|sudo)\\b',
      },
    });
    expect(root).toBe(path.join(cwd, '.cursor'));
    const hooks = JSON.parse(fs.readFileSync(path.join(cwd, '.cursor', 'hooks.json'), 'utf-8'));
    expect(hooks.hooks.beforeShellExecution[0].matcher).toBe('\\b(rm|sudo)\\b');
    expect(fs.existsSync(path.join(cwd, '.cursor', 'mcp.json'))).toBe(true);
    expect(fs.existsSync(path.join(cwd, '.cursor', 'rules', 'openbox-governance.mdc'))).toBe(true);
    expect(fs.existsSync(path.join(cwd, '.agents', 'skills', 'openbox', 'SKILL.md'))).toBe(true);
    expect(verifyCursorRepoMode({ cwd }).every((check) => check.status === 'pass')).toBe(true);

    uninstallCursorRepoMode({ cwd, removeSkill: true });
    expect(fs.existsSync(path.join(cwd, '.cursor', 'hooks.json'))).toBe(false);
    expect(fs.existsSync(path.join(cwd, '.agents', 'skills', 'openbox'))).toBe(false);
  });
});
