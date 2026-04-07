import { Command } from 'commander';
import { getClient } from '../config.js';
import { output, outputList } from '../output.js';
import { parseJsonInput } from '../input.js';

export function registerGoalCommands(program: Command) {
  const goal = program.command('goal').description('Goal alignment management');

  goal
    .command('update <agentId>')
    .description('Update goal alignment config')
    .option('--threshold <n>', 'Alignment threshold (0-100)')
    .option('--action <action>', 'Drift detection action (alert_only|constrain|terminate)')
    .option(
      '--frequency <freq>',
      'Evaluation frequency (every_action|every_5_actions|every_10_actions|session_end_only)',
    )
    .option('--model <model>', 'LlamaFirewall model (gpt-4o-mini|gpt-4o|claude-3-haiku)')
    .option('--json <json>', 'Full JSON body (overrides other options)')
    .action(async (agentId: string, opts) => {
      try {
        let dto: any;
        if (opts.json) {
          dto = parseJsonInput(opts.json);
        } else {
          dto = {} as any;
          if (opts.threshold) dto.alignment_threshold = parseInt(opts.threshold);
          if (opts.action) dto.drift_detection_action = opts.action;
          if (opts.frequency) dto.evaluation_frequency = opts.frequency;
          if (opts.model) dto.llama_firewall_model = opts.model;
        }
        const data = await getClient().updateGoalAlignment(agentId, dto);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  goal
    .command('trend <agentId>')
    .description('Get goal alignment trend')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .action(async (agentId: string, opts) => {
      try {
        const data = await getClient().getGoalAlignmentTrend(agentId, {
          fromTime: opts.from,
          toTime: opts.to,
        });
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
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
        console.error(err.message || err);
        process.exit(1);
      }
    });
}
