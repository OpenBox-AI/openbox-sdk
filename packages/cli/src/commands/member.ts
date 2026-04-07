import { Command } from 'commander';
import { getClient } from '../config.js';
import { output, outputList } from '../output.js';
import { parseJsonInput } from '../input.js';

export function registerMemberCommands(program: Command) {
  const member = program.command('member').description('Member management');

  member
    .command('list <orgId>')
    .description('List members')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .action(async (orgId: string, opts) => {
      try {
        const data = await getClient().listMembers(orgId, {
          page: parseInt(opts.page),
          perPage: parseInt(opts.limit),
        });
        outputList(data, 'members');
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  member
    .command('create <orgId>')
    .description('Create a user')
    .requiredOption('--username <name>', 'Username')
    .requiredOption('--email <email>', 'Email')
    .option('--first-name <name>', 'First name', '')
    .option('--last-name <name>', 'Last name', '')
    .option('--password <pass>', 'Password')
    .option('--verified', 'Email verified', false)
    .option('--json <json>', 'Full JSON body (overrides other options)')
    .action(async (orgId: string, opts) => {
      try {
        let dto: any;
        if (opts.json) {
          dto = parseJsonInput(opts.json);
        } else {
          dto = {
            username: opts.username,
            email: opts.email,
            firstName: opts.firstName,
            lastName: opts.lastName,
            password: opts.password || '',
            emailVerified: opts.verified,
            roles: [],
          };
        }
        const data = await getClient().createUser(orgId, dto);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  member
    .command('update <orgId> <userId>')
    .description('Update a member')
    .option('--role <role>', 'Role')
    .option('--teams <ids...>', 'Team IDs')
    .option('--json <json>', 'Full JSON body')
    .action(async (orgId: string, userId: string, opts) => {
      try {
        let dto: any;
        if (opts.json) {
          dto = parseJsonInput(opts.json);
        } else {
          dto = {
            role: opts.role || '',
            team_ids: opts.teams || [],
          };
        }
        const data = await getClient().updateMember(orgId, userId, dto);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  member
    .command('assign-roles <orgId> <userId>')
    .description('Assign roles to a member')
    .requiredOption('--roles <roles...>', 'Role names')
    .action(async (orgId: string, userId: string, opts) => {
      try {
        const data = await getClient().assignRoles(orgId, userId, opts.roles);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  member
    .command('remove-roles <orgId> <userId>')
    .description('Remove roles from a member')
    .requiredOption('--roles <roles...>', 'Role names')
    .action(async (orgId: string, userId: string, opts) => {
      try {
        const data = await getClient().removeRoles(orgId, userId, opts.roles);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  member
    .command('remove <orgId>')
    .description('Remove members')
    .requiredOption('--ids <ids...>', 'Member IDs to remove')
    .action(async (orgId: string, opts) => {
      try {
        const data = await getClient().removeMembers(orgId, opts.ids);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  member
    .command('invite <orgId>')
    .description('Invite a user')
    .requiredOption('--email <email>', 'Email address')
    .option('--roles <roles...>', 'Role names')
    .action(async (orgId: string, opts) => {
      try {
        const data = await getClient().inviteUser(orgId, {
          email: opts.email,
          roles: opts.roles,
        });
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });
}
