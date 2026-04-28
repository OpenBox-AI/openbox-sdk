// `openbox guardrail` - fully spec-driven (H.3 + I + J). create/update
// use @cli_post_validate("guardrailCrossField"); reorder/test stay
// custom-shell because they have non-canonical wire shapes that
// don't fit the body/positional pattern yet.
import { Command } from 'commander';
import { getClient } from '../config.js';
import { output } from '../output.js';
import { parseJsonInput } from '../input.js';
import { reportAndExit } from '../validators/index.js';
import { wireSubcommands } from '../wire-subcommands.js';
import { GUARDRAIL_HANDLERS } from '../generated/cli-handlers/guardrail.js';

export function registerGuardrailCommands(program: Command) {
  const guardrail = program.command('guardrail').description('Guardrail management');
  wireSubcommands(guardrail, GUARDRAIL_HANDLERS, getClient as never);

  guardrail
    .command('reorder <agentId> <guardrailId> <order>')
    .description('Reorder a guardrail')
    .action(async (agentId: string, guardrailId: string, order: string) => {
      try {
        const data = await getClient().reorderGuardrail(agentId, guardrailId, { order: parseInt(order) });
        output(data);
      } catch (err) {
        reportAndExit(err);
      }
    });

  guardrail
    .command('test')
    .description('Run a guardrail test')
    .option('--type <type>', 'Guardrail type (1=PII, 2=NSFW, 3=Toxicity, 4=BanList, 5=Regex)')
    .option('--text <text>', 'Text to test against the guardrail')
    .option('--json <json>', 'Full JSON body (overrides other options)')
    .action(async (opts) => {
      try {
        let dto: any;
        if (opts.json) {
          dto = parseJsonInput(opts.json);
        } else {
          const GUARDRAIL_TYPE_MAP: Record<string, string> = {
            pii_detection: '1', pii: '1',
            nsfw: '2', nsfw_detection: '2', content_safety: '2',
            toxicity: '3', toxicity_detection: '3',
            ban_list: '4', ban_words: '4',
            regex: '5', regex_match: '5',
          };
          const resolvedType = GUARDRAIL_TYPE_MAP[opts.type] || opts.type;
          const testText = opts.text || 'test input';
          dto = {
            guardrail_type: resolvedType,
            params: {},
            settings: {
              on_fail: 1,
              activities: [{ activity_type: 'PromptSubmission', fields_to_check: ['input.*.prompt'] }],
            },
            logs: {
              event_type: 'ActivityStarted',
              activity_type: 'PromptSubmission',
              input: [{ prompt: testText }],
              output: null,
              signal_name: null,
            },
          };
        }
        const data = await getClient().runGuardrailTest(dto);
        output(data);
      } catch (err) {
        reportAndExit(err);
      }
    });
}
