import { Command } from 'commander';
import { getClient } from '../config.js';
import { output } from '../output.js';

export function registerApiKeyCommands(program: Command) {
  const apiKey = program.command('api-key').description('API key management');

  apiKey
    .command('rotate <agentId>')
    .description('Rotate API key for an agent')
    .action(async (agentId: string) => {
      try {
        const data = await getClient().rotateApiKey(agentId);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
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
        console.error(err.message || err);
        process.exit(1);
      }
    });
}
