import { Command } from 'commander';
import { getClient } from '../config.js';
import { output, outputList } from '../output.js';
import { parseJsonInput } from '../input.js';
import { reportAndExit, validateInt, validateEnum, validateIsoDate } from '../validators/index.js';

export function registerGoalCommands(program: Command) {
  const goal = program.command('goal').description('Goal alignment management');

  goal
    .command('update <agentId>')
    .description('Update goal alignment config (all four fields required unless --json)')
    .option('--threshold <n>', 'Alignment threshold (0-100)')
    .option('--action <action>', 'Drift detection action (alert_only|constrain|terminate)')
    .option(
      '--frequency <freq>',
      'Evaluation frequency (every_action|every_5_actions|every_10_actions|session_end_only)',
    )
    .option('--model <model>', 'LlamaFirewall model - backend enforces its own enum; omit hint if unsure')
    .option('--json <json>', 'Full JSON body (overrides other options)')
    .action(async (agentId: string, opts) => {
      try {
        let dto: any;
        if (opts.json) {
          dto = parseJsonInput(opts.json);
        } else {
          // Backend GoalAlignmentConfigDto marks all four fields required. Partial flag
          // combinations would be silently rejected with a backend 400 - fail fast here.
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
          // Backend enforces enums on action + frequency; catch bad values before POSTing
          // so the user sees a local error that lists the allowed values.
          const DRIFT_ACTIONS = ['alert_only', 'constrain', 'terminate'] as const;
          const FREQUENCIES = [
            'every_action',
            'every_5_actions',
            'every_10_actions',
            'session_end_only',
          ] as const;
          dto = {
            alignment_threshold: validateInt(opts.threshold, '--threshold', { min: 0, max: 100 }),
            drift_detection_action: validateEnum(opts.action, DRIFT_ACTIONS, '--action'),
            evaluation_frequency: validateEnum(opts.frequency, FREQUENCIES, '--frequency'),
            llama_firewall_model: opts.model,
          };
        }
        const data = await getClient().updateGoalAlignment(agentId, dto);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  goal
    .command('trend <agentId>')
    .description('Get goal alignment trend')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .action(async (agentId: string, opts) => {
      try {
        if (opts.from) validateIsoDate(opts.from, '--from');
        if (opts.to) validateIsoDate(opts.to, '--to');
        const data = await getClient().getGoalAlignmentTrend(agentId, {
          fromTime: opts.from,
          toTime: opts.to,
        });
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  goal
    .command('drifts <agentId>')
    .description('Get recent goal alignment drifts')
    .option('-l, --limit <n>', 'Number of drifts', '10')
    .action(async (agentId: string, opts) => {
      try {
        const data = await getClient().getGoalAlignmentRecentDrifts(agentId, parseInt(opts.limit));
        outputList(data, 'drifts');
      } catch (err: any) {
        reportAndExit(err);
      }
    });
}
