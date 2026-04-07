import { Command } from 'commander';
import { getClient } from '../config.js';
import { output, outputList } from '../output.js';

export function registerViolationCommands(program: Command) {
  const violation = program.command('violation').description('Violation management');

  violation
    .command('list')
    .description('Get all violations')
    .action(async () => {
      try {
        const data = await getClient().getAllViolations();
        outputList(data, 'violations');
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  violation
    .command('agent <agentId>')
    .description('Get violations for an agent')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .option('--pattern <pattern>', 'Pattern filter')
    .option('--source-type <type>', 'Source type filter')
    .action(async (agentId: string, opts) => {
      try {
        const data = await getClient().getAgentViolations(agentId, {
          page: parseInt(opts.page),
          perPage: parseInt(opts.limit),
          pattern: opts.pattern,
          sourceType: opts.sourceType,
        });
        outputList(data, 'violations');
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  violation
    .command('false-positive <agentId> <violationId> <sourceType>')
    .description('Mark a violation as false positive')
    .action(async (agentId: string, violationId: string, sourceType: string) => {
      try {
        const data = await getClient().markFalsePositive(agentId, violationId, sourceType);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });
}
