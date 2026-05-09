// `openbox aivss`; fully spec-driven (H.3 + I). update parses --json
// into the `aivss_config` body field via @cli_parse("json") +
// @cli_body_key("aivss_config"); calculate uses
// @cli_json_merge("replace").
import { Command } from 'commander';
import { getClient } from '../config.js';
import { wireSubcommands } from '../wire-subcommands.js';
import { wireRecipes } from '../recipes.js';
import { AIVSS_HANDLERS } from '../generated/cli-handlers/aivss.js';
import { AIVSS_RECIPES } from '../generated/cli-recipes/aivss.js';

export function registerAivssCommands(program: Command) {
  const aivss = program.command('aivss').description('AIVSS risk assessment');
  wireSubcommands(aivss, AIVSS_HANDLERS, getClient as never);
  wireRecipes(aivss, AIVSS_RECIPES, getClient as never);
}
