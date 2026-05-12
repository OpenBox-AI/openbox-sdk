import { Command } from 'commander';
import { EXIT, bailWith } from '../exit-codes.js';
import { error, info } from '../output.js';

/** `openbox claude-code <subcommand>`:
 *
 *    hook        stdin to governance to stdout, invoked by Claude
 *                Code per hook event.
 *    install     write the hook block (and optionally the MCP entry)
 *                at the chosen scope (global / project / local).
 *    uninstall   remove the same block.
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

  claude
    .command('install')
    .description(
      'Install the Claude Code hook block and (optionally) the MCP ' +
        'server entry. Use --scope project to scope to <cwd>, or ' +
        '--scope local for a personal, gitignored override.',
    )
    .option('--no-mcp', 'Skip the MCP server entry')
    .option('--scope <scope>', 'global | project | local', 'global')
    .option('--cwd <dir>', 'Project root for --scope project/local')
    .action(
      async (opts: { mcp?: boolean; scope?: string; cwd?: string }) => {
        const scope = (opts.scope ?? 'global').toLowerCase();
        if (scope !== 'global' && scope !== 'project' && scope !== 'local') {
          error(`--scope: invalid value '${opts.scope}'; expected global, project, or local`);
          bailWith(EXIT.USAGE);
        }
        const cwd = opts.cwd ?? process.cwd();
        const { installClaudeCode } = await import('../../runtime/claude-code/install.js');
        installClaudeCode({ scope: scope as 'global' | 'project' | 'local', cwd });
        if (opts.mcp !== false) {
          info('');
          const { installMcp } = await import('../../runtime/mcp/install.js');
          installMcp({
            targets: ['claude-code'],
            scope: scope === 'local' ? 'project' : (scope as 'global' | 'project'),
            cwd,
          });
        }
      },
    );

  claude
    .command('uninstall')
    .description('Remove the Claude Code hook block and (optionally) the MCP entry')
    .option('--no-mcp', 'Skip removing the MCP server entry')
    .option('--scope <scope>', 'global | project | local', 'global')
    .option('--cwd <dir>', 'Project root for --scope project/local')
    .action(
      async (opts: { mcp?: boolean; scope?: string; cwd?: string }) => {
        const scope = (opts.scope ?? 'global').toLowerCase();
        if (scope !== 'global' && scope !== 'project' && scope !== 'local') {
          error(`--scope: invalid value '${opts.scope}'; expected global, project, or local`);
          bailWith(EXIT.USAGE);
        }
        const cwd = opts.cwd ?? process.cwd();
        const { uninstallClaudeCode } = await import('../../runtime/claude-code/install.js');
        uninstallClaudeCode({ scope: scope as 'global' | 'project' | 'local', cwd });
        if (opts.mcp !== false) {
          info('');
          const { uninstallMcp } = await import('../../runtime/mcp/install.js');
          uninstallMcp({
            targets: ['claude-code'],
            scope: scope === 'local' ? 'project' : (scope as 'global' | 'project'),
            cwd,
          });
        }
      },
    );
}
