// `openbox org`; fully spec-driven (H.3 + I + M). All dashboard sub-
// endpoints, update-settings, register, and demo-status are migrated.
import { Command } from 'commander';
import { getClient } from '../config.js';
import { wireSubcommands } from '../wire-subcommands.js';
import { ORG_HANDLERS } from '../generated/cli-handlers/org.js';

export function registerOrgCommands(program: Command) {
  const org = program.command('org').description('Organization management');
  wireSubcommands(org, ORG_HANDLERS, getClient as never);
}
