import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOOK_SPEC } from '../../ts/src/core-client/generated/runtime/codex.js';
import {
  codexMarketplaceFile,
  codexPluginTargetDir,
  codexRepoSkillTargetDir,
  exportCodexPlugin,
  installCodex,
  installCodexPlugin,
  uninstallCodexPlugin,
  uninstallCodex,
  verifyCodexPlugin,
  verifyCodexInstall,
} from '../../ts/src/runtime/codex/index.js';
import { installMcpEntry, resolveInstallPaths, uninstallMcpEntry } from '../../ts/src/install/from-spec.js';

const EXPECTED_EVENTS = [
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'Stop',
];

describe('codex HOOK_SPEC', () => {
  it('exposes the project-local Codex hook events in spec order', () => {
    expect(HOOK_SPEC.events.map((event) => event.name)).toEqual(EXPECTED_EVENTS);
    expect(HOOK_SPEC.style).toBe('codex-array');
    expect(HOOK_SPEC.command).toBe('openbox codex hook');
  });

  it('installs and removes only project-local Codex files', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'openbox-codex-install-'));
    installCodex({ cwd });

    const hooksFile = path.join(cwd, '.codex', 'hooks.json');
    const configFile = path.join(cwd, '.codex-hooks', 'config.json');
    const hooks = JSON.parse(readFileSync(hooksFile, 'utf-8')) as any;
    expect(hooks.hooks.PreToolUse[0].hooks[0]).toMatchObject({
      type: 'command',
      command: 'openbox codex hook',
      timeout: 86400,
    });
    expect(readFileSync(configFile, 'utf-8')).toContain('hitlEnabled');

    const checks = verifyCodexInstall({ cwd });
    expect(checks.filter((check) => check.status === 'fail')).toEqual([]);

    uninstallCodex({ cwd });
    const after = JSON.parse(readFileSync(hooksFile, 'utf-8')) as any;
    expect(after.hooks).toBeUndefined();
  });

  it('exports and installs Codex plugin, repo skill, and marketplace surfaces', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'openbox-codex-plugin-'));
    const out = path.join(cwd, 'exported-openbox');
    exportCodexPlugin({
      out,
      matchers: {
        PreToolUse: 'Bash|Write',
      },
    });

    expect(existsSync(path.join(out, '.codex-plugin', 'plugin.json'))).toBe(true);
    expect(existsSync(path.join(out, 'skills', 'openbox', 'SKILL.md'))).toBe(true);
    expect(existsSync(path.join(out, 'hooks', 'hooks.json'))).toBe(true);
    expect(existsSync(path.join(out, '.mcp.json'))).toBe(true);
    expect(readFileSync(path.join(out, 'AGENTS.md'), 'utf-8')).toContain('OpenBox Core is the source of truth');

    const hooks = JSON.parse(readFileSync(path.join(out, 'hooks', 'hooks.json'), 'utf-8')) as any;
    expect(hooks.hooks.PreToolUse[0].matcher).toBe('Bash|Write');
    expect(verifyCodexPlugin({ target: out }).every((check) => check.status === 'pass')).toBe(true);

    const target = installCodexPlugin({ cwd });
    expect(target).toBe(codexPluginTargetDir(cwd));
    expect(existsSync(path.join(codexRepoSkillTargetDir(cwd), 'SKILL.md'))).toBe(true);
    expect(readFileSync(codexMarketplaceFile(cwd), 'utf-8')).toContain('"openbox"');
    expect(verifyCodexPlugin({ cwd, includeProjectSurfaces: true }).every((check) => check.status === 'pass')).toBe(true);

    uninstallCodexPlugin({
      cwd,
      removeRepoSkill: true,
      removeMarketplaceEntry: true,
    });
    expect(existsSync(codexPluginTargetDir(cwd))).toBe(false);
    expect(existsSync(codexRepoSkillTargetDir(cwd))).toBe(false);
  });

  it('writes Codex MCP config to trusted .codex/config.toml, not .codex/mcp.json', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'openbox-codex-mcp-'));
    const pathInfo = resolveInstallPaths(HOOK_SPEC, { cwd });
    expect(pathInfo.mcpFile).toBe(path.join(cwd, '.codex', 'config.toml'));

    installMcpEntry(HOOK_SPEC, 'openbox', { command: 'openbox', args: ['mcp', 'serve'] }, { cwd });
    const configToml = readFileSync(path.join(cwd, '.codex', 'config.toml'), 'utf-8');
    expect(configToml).toContain('[mcp_servers.openbox]');
    expect(configToml).toContain('command = "openbox"');
    expect(configToml).toContain('args = ["mcp", "serve"]');
    expect(existsSync(path.join(cwd, '.codex', 'mcp.json'))).toBe(false);

    uninstallMcpEntry(HOOK_SPEC, 'openbox', { cwd });
    expect(readFileSync(path.join(cwd, '.codex', 'config.toml'), 'utf-8')).not.toContain('[mcp_servers.openbox]');
  });
});
