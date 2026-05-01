import { Command } from 'commander';
import { EXIT, bailWith } from '../exit-codes.js';

/** `openbox claude-code hook`: stdin → governance → stdout, invoked
 *  by Claude Code per hook event. Install lives at `openbox install
 *  claude-code`. */
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
        // Fail-open: unhandled error → Claude Code uses default permissioning.
        // eslint-disable-next-line no-console
        console.error('[openbox claude-code hook] fatal:', (err as Error).message);
        bailWith(EXIT.OK);
      }
    });
}
