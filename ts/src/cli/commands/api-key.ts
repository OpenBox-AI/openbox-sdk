// `openbox api-key`; list / get / delete / revoke / rotate are all
// spec-driven (H.3 + H.10). Rotate uses @cli_output_post to emit the
// one-time runtime-key stderr banner AND cache it to the agent-keys
// store. create / update keep custom shells because the wire
// requires a complete --json DTO body. recall is a local-only read
// of the agent-keys cache; non-destructive alternative to rotate.
import { Command } from 'commander';
import { getClient } from '../config.js';
import { output } from '../output.js';
import { parseJsonInput } from '../../validators/index.js';
import { reportAndExit } from '../../validators/index.js';
import { wireSubcommands } from '../wire-subcommands.js';
import { API_KEY_HANDLERS } from '../generated/cli-handlers/api-key.js';
import { recallAgentKey, agentKeysPath } from '../../runtime/_shared/agent-keys-store.js';
import { EXIT, bailWith } from '../exit-codes.js';

export function registerApiKeyCommands(program: Command) {
  const apiKey = program.command('api-key').description('API key management');
  wireSubcommands(apiKey, API_KEY_HANDLERS, getClient as never);

  // `--body` instead of `--json` because the global `--json` boolean
  // (output formatter, defined in cli/index.ts) and a subcommand-level
  // `--json <value>` collide in Commander; the boolean wins and the
  // body never reaches `opts.json`. `-d` mirrors curl's data flag.
  apiKey
    .command('create')
    .description('Create an org-level API key')
    .requiredOption('-d, --body <json>', 'CreateApiKeyDto body')
    .action(async (opts) => {
      try {
        const data = await getClient().createApiKey(parseJsonInput(opts.body));
        output(data);
      } catch (err) {
        reportAndExit(err);
      }
    });

  apiKey
    .command('update <id>')
    .description('Update an org-level API key')
    .requiredOption('-d, --body <json>', 'UpdateApiKeyDto body')
    .action(async (id: string, opts) => {
      try {
        const data = await getClient().updateApiKey(id, parseJsonInput(opts.body));
        output(data);
      } catch (err) {
        reportAndExit(err);
      }
    });

  apiKey
    .command('recall <agentId>')
    .description(
      'Print the cached runtime key for an agent (local read; populated by ' +
        '`agent create` and `api-key rotate`).',
    )
    .action((agentId: string) => {
      const rec = recallAgentKey(agentId);
      if (!rec) {
        bailWith(
          EXIT.NOT_FOUND,
          `No cached runtime key for agent ${agentId}.\n` +
            `  Cache file: ${agentKeysPath()}\n` +
            `  Populate via: openbox agent create ... or openbox api-key rotate ${agentId}.`,
        );
      }
      output({
        agentId: rec.agentId,
        agentName: rec.agentName,
        runtimeKey: rec.runtimeKey,
        recordedAt: rec.recordedAt,
      });
    });
}
