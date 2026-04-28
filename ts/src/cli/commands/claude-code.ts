import { Command } from 'commander';

/**
 * `openbox claude-code <subcommand>` - manages the OpenBox integration
 * with Claude Code.
 *
 *   install    Write the hook block into ~/.claude/settings.json
 *   uninstall  Remove the hook block
 *   hook       Internal: handler invoked by Claude Code per hook event.
 *              Reads stdin, dispatches to the runtime adapter, writes stdout.
 *              hooks.json points at this command.
 */
export function registerClaudeCodeCommands(program: Command) {
  const claude = program.command('claude-code').description('Claude Code integration');

  claude
    .command('install')
    .description('Install OpenBox hooks into ~/.claude/settings.json')
    .action(async () => {
      const { installClaudeHooks } = await import('../../runtime/claude-code/install.js');
      installClaudeHooks();
    });

  claude
    .command('uninstall')
    .description('Remove OpenBox hooks from ~/.claude/settings.json')
    .action(async () => {
      const { uninstallClaudeHooks } = await import('../../runtime/claude-code/install.js');
      uninstallClaudeHooks();
    });

  claude
    .command('hook')
    .description('Run the OpenBox hook handler (invoked by Claude Code per hook event; stdin → governance → stdout)')
    .action(async () => {
      const { runClaudeHook } = await import('../../runtime/claude-code/hook-handler.js');
      try {
        await runClaudeHook();
      } catch (err) {
        // Fail-open: any unhandled error → Claude Code applies its default permissioning.
        // eslint-disable-next-line no-console
        console.error('[openbox claude-code hook] fatal:', (err as Error).message);
        process.exit(0);
      }
    });
}
