import { Command } from 'commander';
import { getClient } from '../config.js';
import { output, outputList } from '../output.js';

export function registerSessionCommands(program: Command) {
  const session = program.command('session').description('Session management');

  session
    .command('list <agentId>')
    .description('List sessions for an agent')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .option('--status <status>', 'Filter by status (pending|completed|failed|blocked|halted)')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .option('--duration <dur>', 'Duration filter (<1min|1-5mins|5-15mins|>15mins)')
    .option('-s, --search <text>', 'Search')
    .action(async (agentId: string, opts) => {
      try {
        const data = await getClient().listSessions(agentId, {
          page: parseInt(opts.page),
          perPage: parseInt(opts.limit),
          status: opts.status,
          fromTime: opts.from,
          toTime: opts.to,
          duration: opts.duration,
          search: opts.search,
        });
        outputList(data, 'sessions');
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  session
    .command('active <agentId>')
    .description('Get active sessions for an agent')
    .action(async (agentId: string) => {
      try {
        const data = await getClient().getActiveSessions(agentId);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  session
    .command('get <agentId> <sessionId>')
    .description('Get session details')
    .action(async (agentId: string, sessionId: string) => {
      try {
        const data = await getClient().getSession(agentId, sessionId);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  session
    .command('logs <agentId> <sessionId>')
    .description('Get session logs')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .option('--event-type <type>', 'Filter by event type')
    .action(async (agentId: string, sessionId: string, opts) => {
      try {
        const data = await getClient().getSessionLogs(agentId, sessionId, {
          page: parseInt(opts.page),
          perPage: parseInt(opts.limit),
          event_type: opts.eventType,
        });
        outputList(data, 'logs');
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  session
    .command('goal-stats <agentId> <sessionId>')
    .description('Get session goal alignment stats')
    .action(async (agentId: string, sessionId: string) => {
      try {
        const data = await getClient().getSessionGoalAlignmentStats(agentId, sessionId);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  session
    .command('trace <agentId> <sessionId>')
    .description('Get session reasoning trace')
    .action(async (agentId: string, sessionId: string) => {
      try {
        const data = await getClient().getSessionReasoningTrace(agentId, sessionId);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  session
    .command('terminate <agentId> <sessionId>')
    .description('Terminate a session')
    .action(async (agentId: string, sessionId: string) => {
      try {
        const data = await getClient().terminateSession(agentId, sessionId);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });
}
