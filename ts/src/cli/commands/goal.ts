// `openbox goal` - fully spec-driven (H.3 + I + M). update uses
// @cli_required_together to enforce the four-fields-required rule
// (bypassed by --json) + @cli_json_merge("replace") for the escape.
import { Command } from 'commander';
import { getClient } from '../config.js';
import { wireSubcommands } from '../wire-subcommands.js';
import { GOAL_HANDLERS } from '../generated/cli-handlers/goal.js';

export function registerGoalCommands(program: Command) {
  const goal = program.command('goal').description('Goal alignment management');
  wireSubcommands(goal, GOAL_HANDLERS, getClient as never);
}
