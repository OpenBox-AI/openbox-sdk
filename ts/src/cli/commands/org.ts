// `openbox org` - most read views are spec-driven (H.3). The dashboard
// sub-endpoints (governance-feed, trust-drift-lanes, governance-slo,
// violation-heatcal), `register`, `demo-status`, and `update-settings`
// stay hand-coded - pin them when the runtime spec catches up.
import { Command } from 'commander';
import { getClient } from '../config.js';
import { output, outputList } from '../output.js';
import { parseJsonInput } from '../input.js';
import { reportAndExit } from '../validators/index.js';
import { wireSubcommands } from '../wire-subcommands.js';
import { ORG_HANDLERS } from '../generated/cli-handlers/org.js';

export function registerOrgCommands(program: Command) {
  const org = program.command('org').description('Organization management');
  wireSubcommands(org, ORG_HANDLERS, getClient as never);

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
      } catch (err) {
        reportAndExit(err);
      }
    });

  org
    .command('governance-feed <orgId>')
    .description('Latest governance events for the dashboard activity feed')
    .option('-l, --limit <n>', 'Number of events to return', '20')
    .action(async (orgId: string, opts) => {
      try {
        const data = await getClient().getGovernanceFeed(orgId, { limit: parseInt(opts.limit) });
        outputList(data, 'governance feed');
      } catch (err) {
        reportAndExit(err);
      }
    });

  org
    .command('trust-drift-lanes <orgId>')
    .description('Per-agent 30-day trust score trajectory')
    .option('-l, --limit <n>', 'Number of agent lanes to return', '8')
    .action(async (orgId: string, opts) => {
      try {
        const data = await getClient().getTrustDriftLanes(orgId, { limit: parseInt(opts.limit) });
        output(data);
      } catch (err) {
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
      } catch (err) {
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
      } catch (err) {
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
      } catch (err) {
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
      } catch (err) {
        reportAndExit(err);
      }
    });
}
