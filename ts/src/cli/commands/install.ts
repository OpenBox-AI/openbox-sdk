// `openbox install <target>` and `openbox uninstall <target>`.
// Stable targets are intentionally small and project-scoped: cursor,
// claude-code.

import { Command } from 'commander';
import { EXIT, bailWith } from '../exit-codes.js';
import { error, info, row, success } from '../output.js';

type HostScope = 'project';

/**
 * Validates and normalizes install scopes for plugin-based host installs.
 * Host plugin installs are project-only; global installs are intentionally
 * rejected.
 */
export function parseHostScope(
  raw: string | undefined,
  _host: 'cursor' | 'claude-code',
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
    .description('Install the project-local Cursor plugin')
    .option('--cwd <dir>', 'Project root for project-local install')
    .option('--plugin-target <dir>', 'Cursor project-local plugin target directory')
    .option('--symlink <dir>', 'Symlink an already-exported plugin folder into Cursor')
    .option(
      '--matcher <pair>',
      "Hook matcher pair `<event>=<regex>` copied into the plugin's hooks/hooks.json. Repeatable.",
      collect,
      [],
    )
    .action(
      async (opts: {
        cwd?: string;
        pluginTarget?: string;
        symlink?: string;
        matcher: string[];
      }) => {
        const { installCursorPlugin, verifyCursorInstall } = await import('../../runtime/cursor/index.js');
        const cwd = opts.cwd ?? process.cwd();
        const target = installCursorPlugin({
          cwd,
          target: opts.pluginTarget,
          symlink: opts.symlink,
          matchers: parseMatchers(opts.matcher),
        });
        success(`Cursor plugin installed at ${target}`);
        info('');
        const checks = verifyCursorInstall({ cwd, pluginTarget: opts.pluginTarget });
        printChecks(checks, 'run `openbox cursor doctor --json` for details');
      },
    );

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
    .option(
      '--matcher <pair>',
      "Hook matcher pair `<event>=<regex>` copied into the plugin's hooks/hooks.json. Repeatable.",
      collect,
      [],
    )
    .option('--include-opt-in-hooks', 'Also install opt-in/invasive hook events such as WorktreeCreate')
    .action(async (opts: {
      scope?: string;
      cwd?: string;
      pluginTarget?: string;
      symlink?: string;
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
    .description('Remove the project-local Cursor plugin')
    .option('--cwd <dir>', 'Project root for project-local install')
    .option('--plugin-target <dir>', 'Cursor project-local plugin target directory')
    .action(
      async (opts: {
        cwd?: string;
        pluginTarget?: string;
      }) => {
        const { uninstallCursorPlugin } = await import('../../runtime/cursor/index.js');
        uninstallCursorPlugin({ cwd: opts.cwd, target: opts.pluginTarget });
        success('Cursor plugin removed');
      },
    );

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
