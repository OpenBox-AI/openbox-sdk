// `openbox behavior`; fully spec-driven (H.3 + I + J). create/update
// use @cli_post_validate("behaviorRuleCrossField") so the
// trigger/states/verdict/approval-timeout cross-field validation runs
// before the call. toggle uses @cli_parse("bool") + @cli_choice.
import { Command } from 'commander';
import { getClient } from '../config.js';
import { wireSubcommands } from '../wire-subcommands.js';
import { wireRecipes } from '../recipes.js';
import { BEHAVIOR_HANDLERS } from '../generated/cli-handlers/behavior.js';
import { BEHAVIOR_RECIPES } from '../generated/cli-recipes/behavior.js';

export function registerBehaviorCommands(program: Command) {
  const behavior = program.command('behavior').description('Behavior rule management');
  wireSubcommands(behavior, BEHAVIOR_HANDLERS, getClient as never);
  wireRecipes(behavior, BEHAVIOR_RECIPES, getClient as never);
}
