import { Command } from 'commander';
import { getClient } from '../config.js';
import { output, outputList } from '../output.js';

export function registerTrustCommands(program: Command) {
  const trust = program.command('trust').description('Trust management');

  trust
    .command('histories <agentId>')
    .description('Get trust score histories')
    .option('--duration <dur>', 'Duration (7d|30d|90d|1y)', '7d')
    .action(async (agentId: string, opts) => {
      try {
        const data = await getClient().getTrustHistories(agentId, opts.duration);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  trust
    .command('events <agentId>')
    .description('Get trust events')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .action(async (agentId: string, opts) => {
      try {
        const data = await getClient().getTrustEvents(agentId, {
          page: parseInt(opts.page),
          perPage: parseInt(opts.limit),
          fromTime: opts.from,
          toTime: opts.to,
        });
        outputList(data, 'trust events');
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  trust
    .command('tier-changes <agentId>')
    .description('Get trust tier changes')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .action(async (agentId: string, opts) => {
      try {
        const data = await getClient().getTrustTierChanges(agentId, {
          page: parseInt(opts.page),
          perPage: parseInt(opts.limit),
          fromTime: opts.from,
          toTime: opts.to,
        });
        outputList(data, 'tier changes');
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  trust
    .command('recovery <agentId>')
    .description('Get trust recovery status')
    .action(async (agentId: string) => {
      try {
        const data = await getClient().getTrustRecoveryStatus(agentId);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });
}
