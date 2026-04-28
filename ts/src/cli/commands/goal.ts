// `openbox goal` - trend / drifts are spec-driven (H.3). `update` keeps
// a custom shell: the four-required-fields rule + range/enum cross-
// validation + --json fallback don't fit the canonical body shape yet.
import { Command } from 'commander';
import { getClient } from '../config.js';
import { output } from '../output.js';
import { parseJsonInput } from '../input.js';
import { reportAndExit, validateInt, validateEnum } from '../validators/index.js';
import { wireSubcommands } from '../wire-subcommands.js';
import { GOAL_HANDLERS } from '../generated/cli-handlers/goal.js';

const DRIFT_ACTIONS = ['alert_only', 'constrain', 'terminate'] as const;
const FREQUENCIES = ['every_action', 'every_5_actions', 'every_10_actions', 'session_end_only'] as const;

export function registerGoalCommands(program: Command) {
  const goal = program.command('goal').description('Goal alignment management');
  wireSubcommands(goal, GOAL_HANDLERS, getClient as never);

  goal
    .command('update <agentId>')
    .description('Update goal alignment config (all four fields required unless --json)')
    .option('--threshold <n>', 'Alignment threshold (0-100)')
    .option('--action <action>', 'Drift detection action (alert_only|constrain|terminate)')
    .option('--frequency <freq>', 'Evaluation frequency (every_action|every_5_actions|every_10_actions|session_end_only)')
    .option('--model <model>', 'LlamaFirewall model - backend enforces its own enum; omit hint if unsure')
    .option('--json <json>', 'Full JSON body (overrides other options)')
    .action(async (agentId: string, opts) => {
      try {
        let dto: any;
        if (opts.json) {
          dto = parseJsonInput(opts.json);
        } else {
          const missing: string[] = [];
          if (!opts.threshold) missing.push('--threshold');
          if (!opts.action) missing.push('--action');
          if (!opts.frequency) missing.push('--frequency');
          if (!opts.model) missing.push('--model');
          if (missing.length) {
            console.error(
              `Error: goal update requires all config fields. Missing: ${missing.join(', ')}.\n` +
                `Either pass all four flags or use --json with the full body.`,
            );
            process.exit(2);
          }
          dto = {
            alignment_threshold: validateInt(opts.threshold, '--threshold', { min: 0, max: 100 }),
            drift_detection_action: validateEnum(opts.action, DRIFT_ACTIONS, '--action'),
            evaluation_frequency: validateEnum(opts.frequency, FREQUENCIES, '--frequency'),
            llama_firewall_model: opts.model,
          };
        }
        const data = await getClient().updateGoalAlignment(agentId, dto);
        output(data);
      } catch (err) {
        reportAndExit(err);
      }
    });
}
