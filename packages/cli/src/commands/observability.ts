import { Command } from 'commander';
import { getClient } from '../config.js';
import { output, outputList } from '../output.js';

export function registerObservabilityCommands(program: Command) {
  const observe = program.command('observe').description('Observability');

  observe
    .command('data <agentId>')
    .description('Get observability data')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .action(async (agentId: string, opts) => {
      try {
        const data = await getClient().getObservability(agentId, {
          fromTime: opts.from,
          toTime: opts.to,
        });
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  observe
    .command('issues <agentId>')
    .description('Get agent issues')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .action(async (agentId: string, opts) => {
      try {
        const data = await getClient().getIssues(agentId, {
          page: parseInt(opts.page),
          perPage: parseInt(opts.limit),
        });
        outputList(data, 'issues');
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  observe
    .command('insights <agentId>')
    .description('Get insights metrics')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .action(async (agentId: string, opts) => {
      try {
        const data = await getClient().getInsightsMetrics(agentId, {
          fromTime: opts.from,
          toTime: opts.to,
        });
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  observe
    .command('logs <agentId>')
    .description('Get agent logs')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .action(async (agentId: string, opts) => {
      try {
        const data = await getClient().getAgentLogs(agentId, {
          page: parseInt(opts.page),
          perPage: parseInt(opts.limit),
        });
        outputList(data, 'logs');
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  observe
    .command('drift <agentId>')
    .description('Get drift logs')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .action(async (agentId: string, opts) => {
      try {
        const data = await getClient().getDriftLogs(agentId, {
          page: parseInt(opts.page),
          perPage: parseInt(opts.limit),
        });
        outputList(data, 'drift logs');
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  observe
    .command('metrics')
    .description('Get agent metrics (global)')
    .action(async () => {
      try {
        const data = await getClient().getAgentMetrics();
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });
}
