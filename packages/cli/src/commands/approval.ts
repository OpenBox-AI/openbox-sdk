import { Command } from 'commander';
import { getClient } from '../config.js';
import { output, outputList } from '../output.js';

export function registerApprovalCommands(program: Command) {
  const approval = program.command('approval').description('Approval management');

  approval
    .command('metrics <agentId>')
    .description('Get approval metrics')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .action(async (agentId: string, opts) => {
      try {
        const data = await getClient().getApprovalMetrics(agentId, {
          fromTime: opts.from,
          toTime: opts.to,
        });
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  approval
    .command('pending <agentId>')
    .description('Get pending approvals')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .option('-s, --search <text>', 'Search')
    .option('--status <status>', 'Status filter')
    .option('--tiers <tiers...>', 'Tier filter')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .action(async (agentId: string, opts) => {
      try {
        const data = await getClient().getPendingApprovals(agentId, {
          page: parseInt(opts.page),
          perPage: parseInt(opts.limit),
          search: opts.search,
          status: opts.status,
          tiers: opts.tiers,
          fromTime: opts.from,
          toTime: opts.to,
        });
        outputList(data, 'pending approvals');
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  approval
    .command('history <agentId>')
    .description('Get approval history')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .option('-s, --search <text>', 'Search')
    .option('--status <status>', 'Status filter')
    .option('--tiers <tiers...>', 'Tier filter')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .action(async (agentId: string, opts) => {
      try {
        const data = await getClient().getApprovalHistory(agentId, {
          page: parseInt(opts.page),
          perPage: parseInt(opts.limit),
          search: opts.search,
          status: opts.status,
          tiers: opts.tiers,
          fromTime: opts.from,
          toTime: opts.to,
        });
        outputList(data, 'approval history');
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  approval
    .command('decide <agentId> <eventId> <action>')
    .description('Decide on an approval (approve|reject)')
    .action(async (agentId: string, eventId: string, action: string) => {
      try {
        if (action !== 'approve' && action !== 'reject') {
          console.error('Action must be "approve" or "reject"');
          process.exit(1);
        }
        const data = await getClient().decideApproval(
          agentId,
          eventId,
          action as 'approve' | 'reject',
        );
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });
}
