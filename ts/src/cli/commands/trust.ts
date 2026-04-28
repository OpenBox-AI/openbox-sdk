import { Command } from 'commander';
import { getClient } from '../config.js';
import { output, outputList } from '../output.js';
import { reportAndExit, validateEnum, parsePagination, validateIsoDate } from '../validators/index.js';

// Backend accepts only these four duration window strings. Anything else
// returns an empty result silently - a local validateEnum catches the typo
// before the user is confused by an empty response.
const TRUST_DURATIONS = ['7d', '30d', '90d', '1y'] as const;

export function registerTrustCommands(program: Command) {
  const trust = program.command('trust').description('Trust management');

  trust
    .command('histories <agentId>')
    .description('Get trust score histories')
    .option('--duration <dur>', `Duration (${TRUST_DURATIONS.join('|')})`, '7d')
    .action(async (agentId: string, opts) => {
      try {
        validateEnum(opts.duration, TRUST_DURATIONS, '--duration');
        const data = await getClient().getTrustHistories(agentId, opts.duration);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
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
        if (opts.from) validateIsoDate(opts.from, '--from');
        if (opts.to) validateIsoDate(opts.to, '--to');
        const data = await getClient().getTrustEvents(agentId, {
          ...parsePagination(opts),
          fromTime: opts.from,
          toTime: opts.to,
        });
        outputList(data, 'trust events');
      } catch (err: any) {
        reportAndExit(err);
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
        if (opts.from) validateIsoDate(opts.from, '--from');
        if (opts.to) validateIsoDate(opts.to, '--to');
        const data = await getClient().getTrustTierChanges(agentId, {
          ...parsePagination(opts),
          fromTime: opts.from,
          toTime: opts.to,
        });
        outputList(data, 'tier changes');
      } catch (err: any) {
        reportAndExit(err);
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
        reportAndExit(err);
      }
    });
}
