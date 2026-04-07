import { Command } from 'commander';
import { getClient } from '../config.js';
import { output, outputList } from '../output.js';
import { parseJsonInput } from '../input.js';

export function registerTeamCommands(program: Command) {
  const team = program.command('team').description('Team management');

  team
    .command('list <orgId>')
    .description('List teams')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .action(async (orgId: string, opts) => {
      try {
        const data = await getClient().listTeams(orgId, {
          page: parseInt(opts.page),
          perPage: parseInt(opts.limit),
        });
        outputList(data, 'teams');
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  team
    .command('stats <orgId>')
    .description('Get team stats')
    .action(async (orgId: string) => {
      try {
        const data = await getClient().getTeamStats(orgId);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  team
    .command('get <orgId> <teamId>')
    .description('Get team details')
    .action(async (orgId: string, teamId: string) => {
      try {
        const data = await getClient().getTeam(orgId, teamId);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  team
    .command('update <orgId> <teamId>')
    .description('Update a team')
    .option('-n, --name <name>', 'Team name')
    .option('-d, --desc <text>', 'Description')
    .option('--icon <icon>', 'Icon')
    .option('--json <json>', 'Full JSON body')
    .action(async (orgId: string, teamId: string, opts) => {
      try {
        let dto: any;
        if (opts.json) {
          dto = parseJsonInput(opts.json);
        } else {
          dto = {} as any;
          if (opts.name) dto.name = opts.name;
          if (opts.desc) dto.description = opts.desc;
          if (opts.icon) dto.icon = opts.icon;
        }
        const data = await getClient().updateTeam(orgId, teamId, dto);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  team
    .command('members <orgId> <teamId>')
    .description('Get team members')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .action(async (orgId: string, teamId: string, opts) => {
      try {
        const data = await getClient().getTeamMembers(orgId, teamId, {
          page: parseInt(opts.page),
          perPage: parseInt(opts.limit),
        });
        outputList(data, 'members');
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });
}
