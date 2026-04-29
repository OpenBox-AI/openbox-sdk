// `openbox api-key` - list / get / delete / revoke / rotate are all
// spec-driven (H.3 + H.10). Rotate uses @cli_output_post to emit the
// one-time runtime-key stderr banner. create / update keep custom
// shells because the wire requires a complete --json DTO body.
import { Command } from 'commander';
import { getClient } from '../config.js';
import { output } from '../output.js';
import { parseJsonInput } from '../../validators/index.js';
import { reportAndExit } from '../../validators/index.js';
import { wireSubcommands } from '../wire-subcommands.js';
import { API_KEY_HANDLERS } from '../generated/cli-handlers/api-key.js';

export function registerApiKeyCommands(program: Command) {
  const apiKey = program.command('api-key').description('API key management');
  wireSubcommands(apiKey, API_KEY_HANDLERS, getClient as never);

  apiKey
    .command('create')
    .description('Create an org-level API key')
    .requiredOption('--json <json>', 'CreateApiKeyDto body')
    .action(async (opts) => {
      try {
        const data = await getClient().createApiKey(parseJsonInput(opts.json));
        output(data);
      } catch (err) {
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
      } catch (err) {
        reportAndExit(err);
      }
    });
}
