import { Command } from 'commander';
import { EXIT, bailWith } from '../exit-codes.js';

/** `openbox cursor hook`: stdin → governance → stdout, invoked by
 *  Cursor per hook event. Install lives at `openbox install cursor`. */
export function registerCursorCommands(program: Command) {
  const cursor = program.command('cursor').description('Cursor IDE integration');

  cursor
    .command('hook')
    .description('Run the OpenBox hook handler (invoked by Cursor per hook event)')
    .action(async () => {
      const { runCursorHook } = await import('../../runtime/cursor/hook-handler.js');
      try {
        await runCursorHook();
      } catch (err) {
        // Fail-open: unhandled error → Cursor uses default permissioning.
        // eslint-disable-next-line no-console
        console.error('[openbox cursor hook] fatal:', (err as Error).message);
        bailWith(EXIT.OK);
      }
    });
}
