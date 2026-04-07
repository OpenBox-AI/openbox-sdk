import { Command } from 'commander';
import { getClient } from '../config.js';
import { output, outputList } from '../output.js';
import { parseJsonInput } from '../input.js';

export function registerAivssCommands(program: Command) {
  const aivss = program.command('aivss').description('AIVSS risk assessment');

  aivss
    .command('assessments <agentId>')
    .description('Get AIVSS assessments')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .action(async (agentId: string, opts) => {
      try {
        const data = await getClient().getAssessments(agentId, {
          page: parseInt(opts.page),
          perPage: parseInt(opts.limit),
          fromTime: opts.from,
          toTime: opts.to,
        });
        outputList(data, 'assessments');
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  aivss
    .command('update <agentId>')
    .description('Update AIVSS config')
    .requiredOption('--json <json>', 'AIVSS config JSON (aivss_config object)')
    .requiredOption('--reason <text>', 'Reason for update')
    .action(async (agentId: string, opts) => {
      try {
        const config = parseJsonInput<any>(opts.json);
        const data = await getClient().updateAivssConfig(agentId, {
          aivss_config: config,
          reason: opts.reason,
        });
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  aivss
    .command('recalculate <agentId>')
    .description('Recalculate AIVSS score')
    .action(async (agentId: string) => {
      try {
        const data = await getClient().recalculateAivss(agentId);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  aivss
    .command('calculate')
    .description('Calculate AIVSS score from config')
    .requiredOption('--json <json>', 'AIVSS config JSON')
    .action(async (opts) => {
      try {
        const config = parseJsonInput<any>(opts.json);
        const data = await getClient().calculateAivss(config);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });
}
