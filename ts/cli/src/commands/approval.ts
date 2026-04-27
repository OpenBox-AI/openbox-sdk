import { Command } from 'commander';
import { getClient } from '../config.js';
import { output, outputList } from '../output.js';
import { reportAndExit, parsePagination, validateEnum, validateIsoDate } from '../validators/index.js';

// Backend ApprovalListQuery enums - mirror ts/types/src/requests.ts:17.
const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'expired'] as const;
const APPROVAL_ACTIONS = ['approve', 'reject'] as const;

export function registerApprovalCommands(program: Command) {
  const approval = program.command('approval').description('Approval management');

  approval
    .command('metrics <agentId>')
    .description('Get approval metrics')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .action(async (agentId: string, opts) => {
      try {
        if (opts.from) validateIsoDate(opts.from, '--from');
        if (opts.to) validateIsoDate(opts.to, '--to');
        const data = await getClient().getApprovalMetrics(agentId, {
          fromTime: opts.from,
          toTime: opts.to,
        });
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  approval
    .command('pending <agentId>')
    .description('Get pending approvals')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .option('-s, --search <text>', 'Search')
    .option('--status <status>', `Status filter (${APPROVAL_STATUSES.join('|')})`)
    .option('--tiers <tiers...>', 'Tier filter')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .action(async (agentId: string, opts) => {
      try {
        if (opts.status) validateEnum(opts.status, APPROVAL_STATUSES, '--status');
        if (opts.from) validateIsoDate(opts.from, '--from');
        if (opts.to) validateIsoDate(opts.to, '--to');
        const data = await getClient().getPendingApprovals(agentId, {
          ...parsePagination(opts),
          search: opts.search,
          status: opts.status,
          tiers: opts.tiers,
          fromTime: opts.from,
          toTime: opts.to,
        });
        outputList(data, 'pending approvals');
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  approval
    .command('history <agentId>')
    .description('Get approval history')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .option('-s, --search <text>', 'Search')
    .option('--status <status>', `Status filter (${APPROVAL_STATUSES.join('|')})`)
    .option('--tiers <tiers...>', 'Tier filter')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .action(async (agentId: string, opts) => {
      try {
        if (opts.status) validateEnum(opts.status, APPROVAL_STATUSES, '--status');
        if (opts.from) validateIsoDate(opts.from, '--from');
        if (opts.to) validateIsoDate(opts.to, '--to');
        const data = await getClient().getApprovalHistory(agentId, {
          ...parsePagination(opts),
          search: opts.search,
          status: opts.status,
          tiers: opts.tiers,
          fromTime: opts.from,
          toTime: opts.to,
        });
        outputList(data, 'approval history');
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  approval
    .command('decide <agentId> <eventId> <action>')
    .description(`Decide on an approval (${APPROVAL_ACTIONS.join('|')})`)
    .action(async (agentId: string, eventId: string, action: string) => {
      try {
        validateEnum(action, APPROVAL_ACTIONS, '<action>');
        const data = await getClient().decideApproval(
          agentId,
          eventId,
          action as 'approve' | 'reject',
        );
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });
}
