import { Command } from 'commander';
import { getClient } from '../config.js';
import { output, outputList } from '../output.js';
import { parseJsonInput } from '../input.js';

export function registerOrgCommands(program: Command) {
  const org = program.command('org').description('Organization management');

  org
    .command('get <orgId>')
    .description('Get organization details')
    .action(async (orgId: string) => {
      try {
        const data = await getClient().getOrganization(orgId);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  org
    .command('settings <orgId>')
    .description('Get organization settings')
    .action(async (orgId: string) => {
      try {
        const data = await getClient().getOrgSettings(orgId);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  org
    .command('update-settings <orgId>')
    .description('Update organization settings')
    .option('-n, --name <name>', 'Organization name')
    .option('--domain <domain>', 'Domain')
    .option('--timezone <tz>', 'Timezone')
    .option('--json <json>', 'Full JSON body')
    .action(async (orgId: string, opts) => {
      try {
        let dto: any;
        if (opts.json) {
          dto = parseJsonInput(opts.json);
        } else {
          dto = {} as any;
          if (opts.name) dto.name = opts.name;
          if (opts.domain) dto.domain = opts.domain;
          if (opts.timezone) dto.timezone = opts.timezone;
        }
        const data = await getClient().updateOrgSettings(orgId, dto);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  org
    .command('dashboard <orgId>')
    .description('Get organization dashboard')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .action(async (orgId: string, opts) => {
      try {
        const data = await getClient().getDashboard(orgId, {
          fromTime: opts.from,
          toTime: opts.to,
        });
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  org
    .command('trends <orgId>')
    .description('Get dashboard tier trends')
    .action(async (orgId: string) => {
      try {
        const data = await getClient().getDashboardTierTrends(orgId);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  org
    .command('sessions <orgId>')
    .description('Get organization sessions')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .option('--status <status>', 'Status filter')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .option('-s, --search <text>', 'Search')
    .action(async (orgId: string, opts) => {
      try {
        const data = await getClient().getOrgSessions(orgId, {
          page: parseInt(opts.page),
          perPage: parseInt(opts.limit),
          status: opts.status,
          fromTime: opts.from,
          toTime: opts.to,
          search: opts.search,
        });
        outputList(data, 'sessions');
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  org
    .command('approvals <orgId>')
    .description('Get organization approvals')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .option('-s, --search <text>', 'Search')
    .option('--status <status>', 'Status filter')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .action(async (orgId: string, opts) => {
      try {
        const data = await getClient().getOrgApprovals(orgId, {
          page: parseInt(opts.page),
          perPage: parseInt(opts.limit),
          search: opts.search,
          status: opts.status,
          fromTime: opts.from,
          toTime: opts.to,
        });
        outputList(data, 'approvals');
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  org
    .command('approval-metrics <orgId>')
    .description('Get organization approval metrics')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .action(async (orgId: string, opts) => {
      try {
        const data = await getClient().getOrgApprovalMetrics(orgId, {
          fromTime: opts.from,
          toTime: opts.to,
        });
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  org
    .command('approval-sla <orgId>')
    .description('Get organization approval SLA')
    .action(async (orgId: string) => {
      try {
        const data = await getClient().getOrgApprovalSla(orgId);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  org
    .command('approval-history <orgId>')
    .description('Get organization approval history')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .action(async (orgId: string, opts) => {
      try {
        const data = await getClient().getOrgApprovalHistory(orgId, {
          page: parseInt(opts.page),
          perPage: parseInt(opts.limit),
        });
        outputList(data, 'approval history');
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });
}
