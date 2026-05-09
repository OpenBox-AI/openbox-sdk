// `openbox team`; fully spec-driven (H.3 + H.9 + I + J). create
// migrated via @cli_at_least_one(["name", "icon"]) + @cli_json_merge.
import { Command } from 'commander';
import { getClient } from '../config.js';
import { wireSubcommands } from '../wire-subcommands.js';
import { wireRecipes } from '../recipes.js';
import { TEAM_HANDLERS } from '../generated/cli-handlers/team.js';
import { TEAM_RECIPES } from '../generated/cli-recipes/team.js';

export function registerTeamCommands(program: Command) {
  const team = program.command('team').description('Team management');
  wireSubcommands(team, TEAM_HANDLERS, getClient as never);
  wireRecipes(team, TEAM_RECIPES, getClient as never);
}
