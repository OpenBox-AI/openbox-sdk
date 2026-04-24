import { Command } from 'commander';
import { getClient } from '../config.js';
import { output, outputList } from '../output.js';
import { parseJsonInput } from '../input.js';
import { reportAndExit, parsePagination } from '../validators/index.js';

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
          ...parsePagination(opts),
        });
        outputList(data, 'teams');
      } catch (err: any) {
        reportAndExit(err);
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
        reportAndExit(err);
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
        reportAndExit(err);
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
        reportAndExit(err);
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
          ...parsePagination(opts),
        });
        outputList(data, 'members');
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  team
    .command('create <orgId>')
    .description('Create a team')
    .option('-n, --name <name>', 'Team name')
    .option('-d, --desc <text>', 'Description')
    .option('--icon <icon>', 'Icon URL')
    .option('--json <json>', 'Full JSON body (use for fields beyond --name/--desc/--icon)')
    .action(async (orgId: string, opts) => {
      try {
        let dto: any;
        if (opts.json) {
          dto = parseJsonInput(opts.json);
        } else {
          dto = {};
          if (opts.name) dto.name = opts.name;
          if (opts.desc) dto.description = opts.desc;
          if (opts.icon) dto.icon = opts.icon;
          if (!opts.name && !opts.icon) {
            console.error(
              'Error: team create needs at least --name or --icon (use --json for the full body).',
            );
            process.exit(2);
          }
        }
        const data = await getClient().createTeam(orgId, dto);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  team
    .command('delete <orgId>')
    .description('Delete one or more teams')
    .requiredOption('--ids <ids...>', 'Team IDs to delete')
    .action(async (orgId: string, opts) => {
      try {
        if (!opts.ids || opts.ids.length === 0) {
          console.error('Error: --ids requires at least one team id.');
          process.exit(2);
        }
        const data = await getClient().deleteTeams(orgId, { ids: opts.ids });
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  team
    .command('add-members <orgId> <teamId>')
    .description('Add users to a team')
    .requiredOption('--user-ids <ids...>', 'User IDs to add')
    .action(async (orgId: string, teamId: string, opts) => {
      try {
        if (!opts.userIds || opts.userIds.length === 0) {
          console.error('Error: --user-ids requires at least one user id.');
          process.exit(2);
        }
        const data = await getClient().addTeamMembers(orgId, teamId, {
          user_ids: opts.userIds,
        });
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  team
    .command('remove-members <orgId> <teamId>')
    .description('Remove users from a team')
    .requiredOption('--user-ids <ids...>', 'User IDs to remove')
    .action(async (orgId: string, teamId: string, opts) => {
      try {
        if (!opts.userIds || opts.userIds.length === 0) {
          console.error('Error: --user-ids requires at least one user id.');
          process.exit(2);
        }
        const data = await getClient().removeTeamMembers(orgId, teamId, {
          user_ids: opts.userIds,
        });
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });
}
