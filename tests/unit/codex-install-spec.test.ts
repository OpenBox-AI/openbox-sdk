import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOOK_SPEC } from '../../ts/src/core-client/generated/runtime/codex.js';
import { PROVIDER_PLUGIN_COMPONENTS } from '../../ts/src/governance/capability-matrix.js';
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

const CODEX_COMPONENTS = PROVIDER_PLUGIN_COMPONENTS.find(
  (entry) => entry.provider === 'codex',
)!.components;

function componentPath(name: string): string {
  const component = CODEX_COMPONENTS.find((entry) => entry.name === name);
  expect(component, `Codex plugin component ${name}`).toBeDefined();
  expect(component!.path, `Codex plugin component ${name} path`).toBeTruthy();
  return component!.path!;
}

function assertExportedSpecComponentPathsExist(root: string): void {
  for (const component of CODEX_COMPONENTS) {
    expect(component.path, `Codex plugin component ${component.name} path`).toBeTruthy();
    if (component.path!.startsWith('.agents/')) continue;
    expect(existsSync(path.join(root, component.path!)), component.name).toBe(true);
  }
}

function assertInstalledSpecComponentPathsExist(cwd: string, pluginRoot: string): void {
  for (const component of CODEX_COMPONENTS) {
    expect(component.path, `Codex plugin component ${component.name} path`).toBeTruthy();
    const root = component.path!.startsWith('.agents/') ? cwd : pluginRoot;
    expect(existsSync(path.join(root, component.path!)), component.name).toBe(true);
  }
}

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
      rulesProjection: {
        agentId: 'agent-codex',
        fetchedAt: 'test',
        version: 1,
        rules: [
          {
            id: 'block-rm-rf',
            source: 'behavior-rule',
            description: 'Block recursive deletion without review',
            body: 'Block recursive deletion without review.',
            trigger: 'always',
            severity: 'block',
            rendererHints: {
              exactShellPrefix: ['rm', '-rf'],
            },
          },
        ],
      },
    });

    assertExportedSpecComponentPathsExist(out);

    const agents = readFileSync(path.join(out, componentPath('agents-md')), 'utf-8');
    expect(agents).toContain('OpenBox Core is the source of truth');
    expect(agents).toContain('- Agent: `agent-codex`');
    const rules = readFileSync(path.join(out, componentPath('rules')), 'utf-8');
    expect(rules).toContain('Only exact shell command-prefix execution policy is projected here');
    expect(rules).toContain('prefix_rule(');
    expect(rules).toContain('pattern = ["rm", "-rf"]');
    expect(rules).toContain('decision = "forbidden"');

    const hooks = JSON.parse(readFileSync(path.join(out, 'hooks', 'hooks.json'), 'utf-8')) as any;
    expect(hooks.hooks.PreToolUse[0].matcher).toBe('Bash|Write');
    expect(verifyCodexPlugin({ target: out }).every((check) => check.status === 'pass')).toBe(true);

    const target = installCodexPlugin({ cwd });
    expect(target).toBe(codexPluginTargetDir(cwd));
    assertInstalledSpecComponentPathsExist(cwd, target);
    expect(existsSync(path.join(cwd, componentPath('repo-skill')))).toBe(true);
    expect(existsSync(path.join(cwd, componentPath('marketplace')))).toBe(true);
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
