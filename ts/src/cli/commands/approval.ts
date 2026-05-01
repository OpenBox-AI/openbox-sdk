// `openbox approval`; fully spec-driven (H.3 + H.9). The decide write
// uses the hybrid call shape via @cli_body_key on the `action`
// positional, so wireSubcommands wraps it into { action } before
// calling decideApproval.
import { Command } from 'commander';
import { getClient } from '../config.js';
import { wireSubcommands } from '../wire-subcommands.js';
import { APPROVAL_HANDLERS } from '../generated/cli-handlers/approval.js';

export function registerApprovalCommands(program: Command) {
  const approval = program.command('approval').description('Approval management');
  wireSubcommands(approval, APPROVAL_HANDLERS, getClient as never);
}
