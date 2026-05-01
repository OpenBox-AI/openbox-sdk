// `openbox sso`; fully spec-driven (H.3 + I). All write ops use
// @cli_json_merge("replace") since the DTOs are entirely user-supplied.
import { Command } from 'commander';
import { getClient } from '../config.js';
import { wireSubcommands } from '../wire-subcommands.js';
import { SSO_HANDLERS } from '../generated/cli-handlers/sso.js';

export function registerSsoCommands(program: Command) {
  const sso = program.command('sso').description('SSO configuration (admin)');
  wireSubcommands(sso, SSO_HANDLERS, getClient as never);
}
