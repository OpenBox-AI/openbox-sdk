// `openbox install <target>` and `openbox uninstall <target>`.
// Stable targets are intentionally small and project-scoped: cursor,
// claude-code, codex.

import { Command } from 'commander';
import { EXIT, bailWith } from '../exit-codes.js';
import { error, info, row, success } from '../output.js';
import type { ConfigureClaudeCodeRuntimeOptions } from '../../runtime/claude-code/index.js';
import type { ConfigureCodexRuntimeOptions } from '../../runtime/codex/index.js';
import type { ConfigureCursorRuntimeOptions } from '../../runtime/cursor/index.js';

type HostScope = 'project';
type HostRuntimeOptions = {
  cwd?: string;
  runtimeApiKey?: string;
  agentId?: string;
  coreUrl?: string;
  approvalMode?: string;
  governanceTimeout?: string;
  hitlMaxWait?: string;
  hitlPollInterval?: string;
};

/**
 * Validates and normalizes install scopes for plugin-based host installs.
 * Host plugin installs are project-only; global installs are intentionally
 * rejected.
 */
export function parseHostScope(
  raw: string | undefined,
  _host: 'cursor' | 'claude-code' | 'codex',
): HostScope {
  const value = (raw ?? 'project').toLowerCase();
  if (value !== 'project') {
    error(`--scope: invalid value '${raw}'; expected project`);
    bailWith(EXIT.USAGE);
  }
  return 'project';
}

function collect(value: string, prev: string[]): string[] {
  return prev.concat([value]);
}

function parseMatchers(pairs: string[] | undefined): Record<string, string> | undefined {
  const matchers: Record<string, string> = {};
  for (const pair of pairs ?? []) {
    const idx = pair.indexOf('=');
    if (idx <= 0) {
      error(`--matcher: invalid pair '${pair}', expected <event>=<regex>`);
      bailWith(EXIT.USAGE);
    }
    matchers[pair.slice(0, idx).trim()] = pair.slice(idx + 1);
  }
  return Object.keys(matchers).length > 0 ? matchers : undefined;
}

function parsePositiveInt(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    error(`${label}: expected a positive integer`);
    bailWith(EXIT.USAGE);
  }
  return parsed;
}

function hasRuntimeOptions(opts: HostRuntimeOptions): boolean {
  return (
    opts.runtimeApiKey !== undefined ||
    opts.agentId !== undefined ||
    opts.coreUrl !== undefined ||
    opts.approvalMode !== undefined ||
    opts.governanceTimeout !== undefined ||
    opts.hitlMaxWait !== undefined ||
    opts.hitlPollInterval !== undefined
  );
}

function parseCursorApprovalMode(value: string | undefined): ConfigureCursorRuntimeOptions['approvalMode'] {
  if (value === undefined) return undefined;
  if (value === 'inline' || value === 'remote') return value;
  error(`--approval-mode: invalid value '${value}'; expected inline or remote`);
  bailWith(EXIT.USAGE);
}

function parseHostApprovalMode(
  value: string | undefined,
): ConfigureClaudeCodeRuntimeOptions['approvalMode'] {
  if (value === undefined) return undefined;
  if (value === 'inline' || value === 'remote' || value === 'defer') return value;
  error(`--approval-mode: invalid value '${value}'; expected inline, remote, or defer`);
  bailWith(EXIT.USAGE);
}

function cursorRuntimeOptions(opts: HostRuntimeOptions): ConfigureCursorRuntimeOptions | undefined {
  if (!hasRuntimeOptions(opts)) return undefined;
  return {
    cwd: opts.cwd,
    apiKey: opts.runtimeApiKey,
    agentId: opts.agentId,
    coreUrl: opts.coreUrl,
    approvalMode: parseCursorApprovalMode(opts.approvalMode),
    governanceTimeout: parsePositiveInt(opts.governanceTimeout, '--governance-timeout'),
    hitlMaxWait: parsePositiveInt(opts.hitlMaxWait, '--hitl-max-wait'),
    hitlPollInterval: parsePositiveInt(opts.hitlPollInterval, '--hitl-poll-interval'),
  };
}

function claudeRuntimeOptions(opts: HostRuntimeOptions): ConfigureClaudeCodeRuntimeOptions | undefined {
  if (!hasRuntimeOptions(opts)) return undefined;
  return {
    cwd: opts.cwd,
    apiKey: opts.runtimeApiKey,
    agentId: opts.agentId,
    coreUrl: opts.coreUrl,
    approvalMode: parseHostApprovalMode(opts.approvalMode),
    governanceTimeout: parsePositiveInt(opts.governanceTimeout, '--governance-timeout'),
    hitlMaxWait: parsePositiveInt(opts.hitlMaxWait, '--hitl-max-wait'),
    hitlPollInterval: parsePositiveInt(opts.hitlPollInterval, '--hitl-poll-interval'),
  };
}

function codexRuntimeOptions(opts: HostRuntimeOptions): ConfigureCodexRuntimeOptions | undefined {
  if (!hasRuntimeOptions(opts)) return undefined;
  return {
    cwd: opts.cwd,
    apiKey: opts.runtimeApiKey,
    agentId: opts.agentId,
    coreUrl: opts.coreUrl,
    approvalMode: parseHostApprovalMode(opts.approvalMode),
    governanceTimeout: parsePositiveInt(opts.governanceTimeout, '--governance-timeout'),
    hitlMaxWait: parsePositiveInt(opts.hitlMaxWait, '--hitl-max-wait'),
    hitlPollInterval: parsePositiveInt(opts.hitlPollInterval, '--hitl-poll-interval'),
  };
}

function printChecks(
  checks: Array<{ name: string; status: string; detail?: string; path?: string }>,
  help: string,
): void {
  const failed = checks.filter((check) => check.status === 'fail');
  for (const check of checks) {
    row(check.name, check.status, check.detail ?? check.path);
  }
  if (failed.length > 0) {
    error('Install verification failed', { help });
    bailWith(EXIT.GENERIC);
  }
}

export function registerInstallCommands(program: Command): void {
  const install = program
    .command('install')
    .description('Install OpenBox client surfaces')
    .action(() => install.help());

  install
    .command('cursor')
    .description('Install the project-local Cursor plugin or repo-mode files')
    .option('--cwd <dir>', 'Project root for project-local install')
    .option('--mode <mode>', 'plugin or repo', 'plugin')
    .option('--plugin-target <dir>', 'Cursor project-local plugin target directory')
    .option('--symlink <dir>', 'Symlink an already-exported plugin folder into Cursor')
    .option('--runtime-api-key <key>', 'Agent runtime key written to project .cursor-hooks/config.json')
    .option('--agent-id <id>', 'Resolve the runtime key from the project OpenBox agent-key cache')
    .option('--core-url <url>', 'Core/runtime policy endpoint written to project .cursor-hooks/config.json')
    .option('--approval-mode <mode>', 'Approval mode: remote or inline')
    .option('--governance-timeout <seconds>', 'Core evaluation request timeout in seconds')
    .option('--hitl-max-wait <seconds>', 'Maximum human-approval wait in seconds')
    .option('--hitl-poll-interval <seconds>', 'Human-approval polling interval in seconds')
    .option(
      '--matcher <pair>',
      "Hook matcher pair `<event>=<regex>` copied into the plugin's hooks/hooks.json. Repeatable.",
      collect,
      [],
    )
    .action(
      async (opts: {
        cwd?: string;
        mode?: string;
        pluginTarget?: string;
        symlink?: string;
        runtimeApiKey?: string;
        agentId?: string;
        coreUrl?: string;
        approvalMode?: string;
        governanceTimeout?: string;
        hitlMaxWait?: string;
        hitlPollInterval?: string;
        matcher: string[];
      }) => {
        const { installCursorPlugin, installCursorRepoMode, verifyCursorInstall } = await import('../../runtime/cursor/index.js');
        const cwd = opts.cwd ?? process.cwd();
        const mode = opts.mode ?? 'plugin';
        if (mode !== 'plugin' && mode !== 'repo') {
          error(`--mode: invalid value '${mode}'; expected plugin or repo`);
          bailWith(EXIT.USAGE);
        }
        const target = mode === 'repo'
          ? installCursorRepoMode({
              cwd,
              matchers: parseMatchers(opts.matcher),
              runtime: cursorRuntimeOptions({ ...opts, cwd }),
            })
          : installCursorPlugin({
              cwd,
              target: opts.pluginTarget,
              symlink: opts.symlink,
              matchers: parseMatchers(opts.matcher),
              runtime: cursorRuntimeOptions({ ...opts, cwd }),
            });
        success(mode === 'repo' ? `Cursor repo mode installed at ${target}` : `Cursor plugin installed at ${target}`);
        info('');
        const checks = verifyCursorInstall({ cwd, pluginTarget: opts.pluginTarget, mode });
        printChecks(checks, 'run `openbox cursor doctor --json` for details');
      },
    );

  install
    .command('codex')
    .description('Install project-local Codex hooks, plugin, skill, marketplace entry, and MCP config')
    .option('--cwd <dir>', 'Project root for project-local install')
    .option('--runtime-api-key <key>', 'Agent runtime key written to project .codex-hooks/config.json')
    .option('--agent-id <id>', 'Resolve the runtime key from the project OpenBox agent-key cache')
    .option('--core-url <url>', 'Core/runtime policy endpoint written to project .codex-hooks/config.json')
    .option('--approval-mode <mode>', 'Approval mode: remote, inline, or defer')
    .option('--governance-timeout <seconds>', 'Core evaluation request timeout in seconds')
    .option('--hitl-max-wait <seconds>', 'Maximum human-approval wait in seconds')
    .option('--hitl-poll-interval <seconds>', 'Human-approval polling interval in seconds')
    .action(async (opts: HostRuntimeOptions) => {
      const { HOOK_SPEC } = await import('../../core-client/generated/runtime/codex.js');
      const { installMcpEntry } = await import('../../install/from-spec.js');
      const { installCodex, installCodexPlugin, verifyCodexInstall } = await import('../../runtime/codex/index.js');
      const cwd = opts.cwd ?? process.cwd();
      installCodex({ cwd });
      const runtime = codexRuntimeOptions({ ...opts, cwd });
      installCodexPlugin({ cwd, runtime });
      installMcpEntry(HOOK_SPEC, 'openbox', { command: 'openbox', args: ['mcp', 'serve'] }, { cwd });
      success('Codex project surfaces installed');
      info('');
      const checks = verifyCodexInstall({ cwd });
      printChecks(checks, 'run `openbox codex doctor --surface-only` for details');
    });

  install
    .command('claude-code')
    .description(
      'Install the project-local Claude Code plugin: hooks, MCP server entry, slash commands, agent, and OpenBox skill.',
    )
    .option(
      '--scope <scope>',
      'project only',
      'project',
    )
    .option('--cwd <dir>', 'Project root for --scope project')
    .option('--plugin-target <dir>', 'Explicit Claude Code plugin target directory')
    .option('--symlink <dir>', 'Symlink an already-exported plugin folder into Claude Code')
    .option('--runtime-api-key <key>', 'Agent runtime key written to project .claude-hooks/config.json')
    .option('--agent-id <id>', 'Resolve the runtime key from the project OpenBox agent-key cache')
    .option('--core-url <url>', 'Core/runtime policy endpoint written to project .claude-hooks/config.json')
    .option('--approval-mode <mode>', 'Approval mode: remote, inline, or defer')
    .option('--governance-timeout <seconds>', 'Core evaluation request timeout in seconds')
    .option('--hitl-max-wait <seconds>', 'Maximum human-approval wait in seconds')
    .option('--hitl-poll-interval <seconds>', 'Human-approval polling interval in seconds')
    .option(
      '--matcher <pair>',
      "Hook matcher pair `<event>=<regex>` copied into the plugin's hooks/hooks.json. Repeatable.",
      collect,
      [],
    )
    .option('--include-opt-in-hooks', 'Also install opt-in hook events such as SessionEnd and WorktreeCreate')
    .action(async (opts: {
      scope?: string;
      cwd?: string;
      pluginTarget?: string;
      symlink?: string;
      runtimeApiKey?: string;
      agentId?: string;
      coreUrl?: string;
      approvalMode?: string;
      governanceTimeout?: string;
      hitlMaxWait?: string;
      hitlPollInterval?: string;
      matcher: string[];
      includeOptInHooks?: boolean;
    }) => {
      const scope = parseHostScope(opts.scope, 'claude-code');
      const cwd = opts.cwd ?? process.cwd();
      const { installClaudeCodePlugin, verifyClaudeCodePlugin } = await import('../../runtime/claude-code/index.js');
      const target = installClaudeCodePlugin({
        scope,
        cwd,
        target: opts.pluginTarget,
        symlink: opts.symlink,
        matchers: parseMatchers(opts.matcher),
        includeOptInHooks: opts.includeOptInHooks,
        runtime: claudeRuntimeOptions({ ...opts, cwd }),
      });
      success(`Claude Code plugin installed at ${target}`);
      info('');
      const checks = verifyClaudeCodePlugin({ scope, cwd, target: opts.pluginTarget });
      printChecks(checks, 'run `openbox claude-code plugin export --out <dir>` for manual inspection');
    });

  const uninstall = program
    .command('uninstall')
    .description('Remove OpenBox client surfaces')
    .action(() => uninstall.help());

  uninstall
    .command('cursor')
    .description('Remove the project-local Cursor plugin or repo-mode files')
    .option('--cwd <dir>', 'Project root for project-local install')
    .option('--mode <mode>', 'plugin or repo', 'plugin')
    .option('--plugin-target <dir>', 'Cursor project-local plugin target directory')
    .action(
      async (opts: {
        cwd?: string;
        mode?: string;
        pluginTarget?: string;
      }) => {
        const { uninstallCursorPlugin, uninstallCursorRepoMode } = await import('../../runtime/cursor/index.js');
        const mode = opts.mode ?? 'plugin';
        if (mode !== 'plugin' && mode !== 'repo') {
          error(`--mode: invalid value '${mode}'; expected plugin or repo`);
          bailWith(EXIT.USAGE);
        }
        if (mode === 'repo') {
          uninstallCursorRepoMode({ cwd: opts.cwd, removeSkill: true });
          success('Cursor repo mode removed');
        } else {
          uninstallCursorPlugin({ cwd: opts.cwd, target: opts.pluginTarget });
          success('Cursor plugin removed');
        }
      },
    );

  uninstall
    .command('codex')
    .description('Remove project-local Codex hooks, plugin, skill, marketplace entry, and MCP config')
    .option('--cwd <dir>', 'Project root for project-local install')
    .action(async (opts: { cwd?: string }) => {
      const { HOOK_SPEC } = await import('../../core-client/generated/runtime/codex.js');
      const { uninstallMcpEntry } = await import('../../install/from-spec.js');
      const { uninstallCodex, uninstallCodexPlugin } = await import('../../runtime/codex/index.js');
      const cwd = opts.cwd ?? process.cwd();
      uninstallCodex({ cwd });
      uninstallCodexPlugin({
        cwd,
        removeRepoSkill: true,
        removeMarketplaceEntry: true,
      });
      uninstallMcpEntry(HOOK_SPEC, 'openbox', { cwd });
      success('Codex project surfaces removed');
    });

  uninstall
    .command('claude-code')
    .description('Remove the project-local Claude Code plugin')
    .option('--scope <scope>', 'project only', 'project')
    .option('--cwd <dir>', 'Project root for --scope project')
    .option('--plugin-target <dir>', 'Explicit Claude Code plugin target directory')
    .action(async (opts: { scope?: string; cwd?: string; pluginTarget?: string }) => {
      const scope = parseHostScope(opts.scope, 'claude-code');
      const cwd = opts.cwd ?? process.cwd();
      const { uninstallClaudeCodePlugin } = await import('../../runtime/claude-code/index.js');
      uninstallClaudeCodePlugin({ scope, cwd, target: opts.pluginTarget });
      success('Claude Code plugin removed');
    });
}
