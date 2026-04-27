import { Command } from 'commander';
import { getClient } from '../config.js';
import { output } from '../output.js';
import { reportAndExit } from '../validators/index.js';

export function registerApiKeyCommands(program: Command) {
  const apiKey = program.command('api-key').description('API key management');

  apiKey
    .command('rotate <agentId>')
    .description('Rotate API key for an agent')
    .action(async (agentId: string) => {
      try {
        const data = await getClient().rotateApiKey(agentId);
        output(data);
        // Same one-time-only highlight as `agent create` - see
        // commands/agent.ts. The previous key is invalidated by this
        // rotation; deployed clients holding the old key will start
        // failing with 401 until updated.
        const newKey = (data as { token?: string } | null)?.token;
        if (typeof newKey === 'string' && (newKey.startsWith('obx_live_') || newKey.startsWith('obx_test_'))) {
          console.error('');
          console.error('────────────────────────────────────────────────────────────');
          console.error('  New runtime API key (capture now - only shown once):');
          console.error(`    ${newKey}`);
          console.error('');
          console.error('  The previous key is now INVALID. Update any deployed');
          console.error('  clients/services that were using the old key.');
          console.error('────────────────────────────────────────────────────────────');
        }
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  apiKey
    .command('revoke <agentId>')
    .description('Revoke API key for an agent')
    .action(async (agentId: string) => {
      try {
        const data = await getClient().revokeApiKey(agentId);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });
}
