import { Command } from 'commander';
import { getClient } from '../config.js';
import { output, outputList } from '../output.js';
import { parseJsonInput } from '../input.js';
import { reportAndExit, parsePagination } from '../validators/index.js';

export function registerApiKeyCommands(program: Command) {
  const apiKey = program.command('api-key').description('API key management');

  // Org-level API key CRUD (the /api-key/* endpoints - distinct from
  // the agent-level /agent/{id}/rotate-api-key + revoke-api-key
  // below). These are admin-tooling for managing programmatic keys
  // attached to the calling org.

  apiKey
    .command('list')
    .description('List org-level API keys')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .action(async (opts) => {
      try {
        const data = await getClient().listApiKeys(parsePagination(opts));
        outputList(data, 'api keys');
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  apiKey
    .command('create')
    .description('Create an org-level API key')
    .requiredOption('--json <json>', 'CreateApiKeyDto body')
    .action(async (opts) => {
      try {
        const data = await getClient().createApiKey(parseJsonInput(opts.json));
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  apiKey
    .command('get <id>')
    .description('Get an org-level API key by id')
    .action(async (id: string) => {
      try {
        const data = await getClient().getApiKey(id);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  apiKey
    .command('update <id>')
    .description('Update an org-level API key')
    .requiredOption('--json <json>', 'UpdateApiKeyDto body')
    .action(async (id: string, opts) => {
      try {
        const data = await getClient().updateApiKey(id, parseJsonInput(opts.json));
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  apiKey
    .command('delete <id>')
    .description('Delete an org-level API key')
    .action(async (id: string) => {
      try {
        const data = await getClient().deleteApiKey(id);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  // Agent-level API key rotation / revocation. Distinct from the
  // org-level CRUD above - these target the runtime obx_live_/obx_test_
  // key bound to a specific agent.

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
