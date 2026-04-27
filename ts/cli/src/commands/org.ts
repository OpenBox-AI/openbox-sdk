import { Command } from 'commander';
import { getClient } from '../config.js';
import { output, outputList } from '../output.js';
import { parseJsonInput } from '../input.js';
import { reportAndExit, parsePagination, validateEnum, validateIsoDate } from '../validators/index.js';

// Session status enum from ts/types/src/requests.ts:26.
const SESSION_STATUSES = ['pending', 'completed', 'failed', 'blocked', 'halted'] as const;
// Approval status - same shape as approval.ts; mirrors requests.ts:17.
const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'expired'] as const;

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
        reportAndExit(err);
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
        reportAndExit(err);
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
        reportAndExit(err);
      }
    });

  org
    .command('dashboard <orgId>')
    .description('Get organization dashboard')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .action(async (orgId: string, opts) => {
      try {
        if (opts.from) validateIsoDate(opts.from, '--from');
        if (opts.to) validateIsoDate(opts.to, '--to');
        const data = await getClient().getDashboard(orgId, {
          fromTime: opts.from,
          toTime: opts.to,
        });
        output(data);
      } catch (err: any) {
        reportAndExit(err);
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
        reportAndExit(err);
      }
    });

  org
    .command('sessions <orgId>')
    .description('Get organization sessions')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .option('--status <status>', `Status filter (${SESSION_STATUSES.join('|')})`)
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .option('-s, --search <text>', 'Search')
    .action(async (orgId: string, opts) => {
      try {
        if (opts.status) validateEnum(opts.status, SESSION_STATUSES, '--status');
        if (opts.from) validateIsoDate(opts.from, '--from');
        if (opts.to) validateIsoDate(opts.to, '--to');
        const data = await getClient().getOrgSessions(orgId, {
          ...parsePagination(opts),
          status: opts.status,
          fromTime: opts.from,
          toTime: opts.to,
          search: opts.search,
        });
        outputList(data, 'sessions');
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  org
    .command('approvals <orgId>')
    .description('Get organization approvals')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .option('-s, --search <text>', 'Search')
    .option('--status <status>', `Status filter (${APPROVAL_STATUSES.join('|')})`)
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .action(async (orgId: string, opts) => {
      try {
        if (opts.status) validateEnum(opts.status, APPROVAL_STATUSES, '--status');
        if (opts.from) validateIsoDate(opts.from, '--from');
        if (opts.to) validateIsoDate(opts.to, '--to');
        const result = await getClient().getOrgApprovals(orgId, {
          ...parsePagination(opts),
          search: opts.search,
          status: opts.status,
          fromTime: opts.from,
          toTime: opts.to,
        });
        // Result is { approvals: PaginatedResponse<Approval>, metrics }.
        // Print the full envelope (counts are useful) but keep the array
        // recognizable for grep/jq pipelines.
        outputList(result.approvals, 'approvals');
        if (result.metrics) {
          console.error(`metrics: ${JSON.stringify(result.metrics)}`);
        }
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  org
    .command('approval-metrics <orgId>')
    .description('Get organization approval metrics')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .action(async (orgId: string, opts) => {
      try {
        if (opts.from) validateIsoDate(opts.from, '--from');
        if (opts.to) validateIsoDate(opts.to, '--to');
        const data = await getClient().getOrgApprovalMetrics(orgId, {
          fromTime: opts.from,
          toTime: opts.to,
        });
        output(data);
      } catch (err: any) {
        reportAndExit(err);
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
        reportAndExit(err);
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
          ...parsePagination(opts),
        });
        outputList(data, 'approval history');
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  // Dashboard sub-endpoints (added in proposal/openapi-organization-
  // path-params; live on backend develop). Each is a thin GET wrapper.

  org
    .command('governance-feed <orgId>')
    .description('Latest governance events for the dashboard activity feed')
    .option('-l, --limit <n>', 'Number of events to return', '20')
    .action(async (orgId: string, opts) => {
      try {
        const data = await getClient().getGovernanceFeed(orgId, {
          limit: parseInt(opts.limit),
        });
        outputList(data, 'governance feed');
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  org
    .command('trust-drift-lanes <orgId>')
    .description('Per-agent 30-day trust score trajectory')
    .option('-l, --limit <n>', 'Number of agent lanes to return', '8')
    .action(async (orgId: string, opts) => {
      try {
        const data = await getClient().getTrustDriftLanes(orgId, {
          limit: parseInt(opts.limit),
        });
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  org
    .command('governance-slo <orgId>')
    .description('Allowed/blocked/halted rates vs targets')
    .option('--window <window>', 'Aggregation window (7d|30d|90d)', '30d')
    .action(async (orgId: string, opts) => {
      try {
        const data = await getClient().getGovernanceSlo(orgId, { window: opts.window });
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  org
    .command('violation-heatcal <orgId>')
    .description('7×24 day-of-week × hour-of-day violation density matrix')
    .option('--window <window>', 'Aggregation window (7d|30d|90d)', '30d')
    .action(async (orgId: string, opts) => {
      try {
        const data = await getClient().getViolationHeatcal(orgId, { window: opts.window });
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  org
    .command('register')
    .description('Provision a new organization (public endpoint, throttled)')
    .requiredOption('--json <json>', 'CreateOrganizationDto body')
    .action(async (opts) => {
      try {
        const data = await getClient().registerOrganization(parseJsonInput(opts.json));
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  org
    .command('demo-status')
    .description('Poll demo-agent setup status (used by FE during onboarding)')
    .action(async () => {
      try {
        const data = await getClient().getDemoSetupStatus();
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });
}
