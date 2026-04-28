// `openbox approval` - metrics / pending / history are spec-driven
// (H.3). `decide` keeps a tiny custom shell because the wire shape is
// (agentId, eventId, { action }) - three positionals plus a body.
import { Command } from 'commander';
import { getClient } from '../config.js';
import { output } from '../output.js';
import { reportAndExit, validateEnum } from '../validators/index.js';
import { wireSubcommands } from '../wire-subcommands.js';
import { APPROVAL_HANDLERS } from '../generated/cli-handlers/approval.js';

const APPROVAL_ACTIONS = ['approve', 'reject'] as const;

export function registerApprovalCommands(program: Command) {
  const approval = program.command('approval').description('Approval management');
  wireSubcommands(approval, APPROVAL_HANDLERS, getClient as never);

  approval
    .command('decide <agentId> <eventId> <action>')
    .description(`Decide on an approval (${APPROVAL_ACTIONS.join('|')})`)
    .action(async (agentId: string, eventId: string, action: string) => {
      try {
        validateEnum(action, APPROVAL_ACTIONS, '<action>');
        const data = await getClient().decideApproval(agentId, eventId, {
          action: action as 'approve' | 'reject',
        });
        output(data);
      } catch (err) {
        reportAndExit(err);
      }
    });
}
