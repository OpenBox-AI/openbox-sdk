import { Command } from 'commander';

/**
 * `openbox cursor <subcommand>` - manages the OpenBox integration with
 * Cursor IDE.
 *
 *   install    Write Cursor hook config into ~/.cursor/hooks.json
 *   uninstall  Remove the OpenBox entries
 *   hook       Internal: handler invoked by Cursor per hook event.
 *              Reads stdin, dispatches via runtime adapter, writes
 *              cursor-permission/cursor-observe-shaped stdout.
 */
export function registerCursorCommands(program: Command) {
  const cursor = program.command('cursor').description('Cursor IDE integration');

  cursor
    .command('install')
    .description('Install OpenBox hooks into ~/.cursor/hooks.json')
    .action(async () => {
      const { installCursorHooks } = await import('../../runtime/cursor/install.js');
      installCursorHooks();
    });

  cursor
    .command('uninstall')
    .description('Remove OpenBox hooks from ~/.cursor/hooks.json')
    .action(async () => {
      const { uninstallCursorHooks } = await import('../../runtime/cursor/install.js');
      uninstallCursorHooks();
    });

  cursor
    .command('hook')
    .description('Run the OpenBox hook handler (invoked by Cursor per hook event)')
    .action(async () => {
      const { runCursorHook } = await import('../../runtime/cursor/hook-handler.js');
      try {
        await runCursorHook();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[openbox cursor hook] fatal:', (err as Error).message);
        process.exit(0);
      }
    });
}
