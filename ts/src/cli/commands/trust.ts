// `openbox trust` - every subcommand is fully spec-driven via H.3
// (@cli_calls + @cli_pagination + @cli_choice + @cli_validator +
// @cli_body_key in specs/typespec/cli/main.tsp). The runtime helper
// in ../wire-subcommands.ts walks the generated TRUST_HANDLERS list
// and registers each subcommand, so this file only registers the
// parent group.
import { Command } from 'commander';
import { getClient } from '../config.js';
import { wireSubcommands } from '../wire-subcommands.js';
import { TRUST_HANDLERS } from '../generated/cli-handlers/trust.js';

export function registerTrustCommands(program: Command) {
  const trust = program.command('trust').description('Trust management');
  wireSubcommands(trust, TRUST_HANDLERS, getClient as never);
}
