import { Command } from 'commander';
import { EXIT, bailWith } from '../exit-codes.js';
import { error, output, success } from '../output.js';

function collectPair(value: string, prior: string[]): string[] {
  return [...prior, value];
}

function parseMatcherPairs(pairs: string[] | undefined): Record<string, string> | undefined {
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

function parsePluginScope(value: string | undefined): 'project' {
  const scope = (value ?? 'project').toLowerCase();
  if (scope !== 'project') {
    error(`--scope: invalid value '${value}'; expected project`);
    bailWith(EXIT.USAGE);
  }
  return 'project';
}

/** `openbox claude-code <subcommand>`:
 *
 *    hook        stdin to governance to stdout, invoked by Claude
 *                Code per hook event.
 *    install     install the project-local Claude Code plugin.
 *    uninstall   remove the project-local Claude Code plugin.
 */
export function registerClaudeCodeCommands(program: Command) {
  const claude = program.command('claude-code').description('Claude Code integration');

  claude
    .command('hook')
    .description('Run the OpenBox hook handler (invoked by Claude Code per hook event)')
    .action(async () => {
      const { runClaudeHook } = await import('../../runtime/claude-code/hook-handler.js');
      try {
        await runClaudeHook();
      } catch (err) {
        // Fail-open: unhandled error means Claude Code uses default permissioning.
        error(`claude-code hook: ${(err as Error).message}`);
        bailWith(EXIT.OK);
      }
    });

  const plugin = claude
    .command('plugin')
    .description('Export or install the project-local OpenBox Claude Code plugin');

  plugin
    .command('export')
    .description('Write a complete marketplace-ready Claude Code plugin folder')
    .requiredOption('--out <dir>', 'Output directory')
    .option(
      '--matcher <pair>',
      "Hook matcher pair `<event>=<regex>` copied into hooks/hooks.json. Repeatable.",
      collectPair,
      [],
    )
    .option('--include-opt-in-hooks', 'Also install opt-in/invasive hook events such as WorktreeCreate')
    .action(async (opts: { out: string; matcher: string[]; includeOptInHooks?: boolean }) => {
      const { exportClaudeCodePlugin, verifyClaudeCodePlugin } = await import(
        '../../runtime/claude-code/index.js'
      );
      const out = exportClaudeCodePlugin({
        out: opts.out,
        matchers: parseMatcherPairs(opts.matcher),
        includeOptInHooks: opts.includeOptInHooks,
      });
      const checks = verifyClaudeCodePlugin({ target: out });
      const failed = checks.filter((check) => check.status === 'fail');
      if (failed.length > 0) {
        output({ out, checks });
        bailWith(EXIT.GENERIC);
      }
      success(`exported Claude Code plugin to ${out}`);
    });

  plugin
    .command('install')
    .description('Install the project-local OpenBox Claude Code plugin only')
    .option('--scope <scope>', 'project only', 'project')
    .option('--cwd <dir>', 'Project root for --scope project')
    .option('--target <dir>', 'Explicit Claude Code plugin target directory')
    .option('--symlink <dir>', 'Symlink an already-exported plugin folder into Claude Code')
    .option(
      '--matcher <pair>',
      "Hook matcher pair `<event>=<regex>` copied into hooks/hooks.json. Repeatable.",
      collectPair,
      [],
    )
    .option('--include-opt-in-hooks', 'Also install opt-in/invasive hook events such as WorktreeCreate')
    .action(
      async (opts: {
        scope?: string;
        cwd?: string;
        target?: string;
        symlink?: string;
        matcher: string[];
        includeOptInHooks?: boolean;
      }) => {
        const { installClaudeCodePlugin } = await import('../../runtime/claude-code/index.js');
        const target = installClaudeCodePlugin({
          scope: parsePluginScope(opts.scope),
          cwd: opts.cwd,
          target: opts.target,
          symlink: opts.symlink,
          matchers: parseMatcherPairs(opts.matcher),
          includeOptInHooks: opts.includeOptInHooks,
        });
        success(`installed Claude Code plugin at ${target}`);
      },
    );

  plugin
    .command('uninstall')
    .description('Remove the project-local OpenBox Claude Code plugin only')
    .option('--scope <scope>', 'project only', 'project')
    .option('--cwd <dir>', 'Project root for --scope project')
    .option('--target <dir>', 'Explicit Claude Code plugin target directory')
    .action(async (opts: { scope?: string; cwd?: string; target?: string }) => {
      const { uninstallClaudeCodePlugin } = await import('../../runtime/claude-code/index.js');
      uninstallClaudeCodePlugin({
        scope: parsePluginScope(opts.scope),
        cwd: opts.cwd,
        target: opts.target,
      });
      success('removed Claude Code plugin');
    });

  claude
    .command('install')
    .description('Alias for `openbox claude-code plugin install`')
    .option('--scope <scope>', 'project only', 'project')
    .option('--cwd <dir>', 'Project root for --scope project')
    .option('--target <dir>', 'Explicit Claude Code plugin target directory')
    .option('--symlink <dir>', 'Symlink an already-exported plugin folder into Claude Code')
    .option(
      '--matcher <pair>',
      "Hook matcher pair `<event>=<regex>` copied into hooks/hooks.json. Repeatable.",
      collectPair,
      [],
    )
    .option('--include-opt-in-hooks', 'Also install opt-in/invasive hook events such as WorktreeCreate')
    .action(
      async (opts: {
        scope?: string;
        cwd?: string;
        target?: string;
        symlink?: string;
        matcher: string[];
        includeOptInHooks?: boolean;
      }) => {
        const { installClaudeCodePlugin } = await import('../../runtime/claude-code/index.js');
        const target = installClaudeCodePlugin({
          scope: parsePluginScope(opts.scope),
          cwd: opts.cwd,
          target: opts.target,
          symlink: opts.symlink,
          matchers: parseMatcherPairs(opts.matcher),
          includeOptInHooks: opts.includeOptInHooks,
        });
        success(`installed Claude Code plugin at ${target}`);
      },
    );

  claude
    .command('uninstall')
    .description('Alias for `openbox claude-code plugin uninstall`')
    .option('--scope <scope>', 'project only', 'project')
    .option('--cwd <dir>', 'Project root for --scope project')
    .option('--target <dir>', 'Explicit Claude Code plugin target directory')
    .action(
      async (opts: { scope?: string; cwd?: string; target?: string }) => {
        const { uninstallClaudeCodePlugin } = await import('../../runtime/claude-code/index.js');
        uninstallClaudeCodePlugin({
          scope: parsePluginScope(opts.scope),
          cwd: opts.cwd,
          target: opts.target,
        });
        success('removed Claude Code plugin');
      },
    );
}
