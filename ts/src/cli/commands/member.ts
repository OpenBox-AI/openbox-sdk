// `openbox member`; fully spec-driven (H.3 + H.9 + I). assign-roles /
// remove-roles use the positional call shape (@cli_calls "positional"
// + variadic) since the wire takes (orgId, userId, rolesArray) rather
// than a body. invite/create/update use @cli_json_merge for the
// --json+flag fill UX.
import { Command } from 'commander';
import { getClient } from '../config.js';
import { wireSubcommands } from '../wire-subcommands.js';
import { MEMBER_HANDLERS } from '../generated/cli-handlers/member.js';

export function registerMemberCommands(program: Command) {
  const member = program.command('member').description('Org member management');
  wireSubcommands(member, MEMBER_HANDLERS, getClient as never);
}
