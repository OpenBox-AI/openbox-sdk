// `openbox team` - list / stats / get / members are spec-driven reads;
// delete / add-members / remove-members became spec-driven writes via
// H.9's @cli_required + @cli_variadic + @cli_body_key combo. Only
// create / update remain hand-coded for the --json + per-flag merge UX.
import { Command } from 'commander';
import { getClient } from '../config.js';
import { output } from '../output.js';
import { parseJsonInput } from '../input.js';
import { reportAndExit } from '../validators/index.js';
import { wireSubcommands } from '../wire-subcommands.js';
import { TEAM_HANDLERS } from '../generated/cli-handlers/team.js';

export function registerTeamCommands(program: Command) {
  const team = program.command('team').description('Team management');
  wireSubcommands(team, TEAM_HANDLERS, getClient as never);

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
            console.error('Error: team create needs at least --name or --icon (use --json for the full body).');
            process.exit(2);
          }
        }
        const data = await getClient().createTeam(orgId, dto);
        output(data);
      } catch (err) {
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
      } catch (err) {
        reportAndExit(err);
      }
    });
}
