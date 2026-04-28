// `openbox observe` - fully spec-driven (H.3) via the @cli_calls,
// @cli_pagination, @cli_validator, and @cli_body_key annotations on
// the Observe interface in specs/typespec/cli/main.tsp.
import { Command } from 'commander';
import { getClient } from '../config.js';
import { wireSubcommands } from '../wire-subcommands.js';
import { OBSERVE_HANDLERS } from '../generated/cli-handlers/observe.js';

export function registerObservabilityCommands(program: Command) {
  const observe = program.command('observe').description('Observability');
  wireSubcommands(observe, OBSERVE_HANDLERS, getClient as never);
}
