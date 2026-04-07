import { Command } from 'commander';
import { getClient } from '../config.js';
import { output, outputList } from '../output.js';
import { parseJsonInput } from '../input.js';

export function registerAuditCommands(program: Command) {
  const audit = program.command('audit').description('Audit log management');

  audit
    .command('list')
    .description('List audit logs')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .option('--event-type <type>', 'Event type filter')
    .option('--actor <id>', 'Actor ID filter')
    .option('--result <result>', 'Result filter (success|failed|denied|warning|approved|allowed)')
    .option('-s, --search <text>', 'Search')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .action(async (opts) => {
      try {
        const data = await getClient().getAuditLogs({
          page: parseInt(opts.page),
          perPage: parseInt(opts.limit),
          eventType: opts.eventType,
          actorId: opts.actor,
          result: opts.result,
          search: opts.search,
          startDate: opts.from,
          endDate: opts.to,
        });
        outputList(data, 'audit logs');
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  audit
    .command('get <logId>')
    .description('Get audit log details')
    .action(async (logId: string) => {
      try {
        const data = await getClient().getAuditLog(logId);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  audit
    .command('export')
    .description('Export audit logs')
    .requiredOption('-n, --name <name>', 'Export name')
    .option('--event-types <types...>', 'Event types')
    .option('--actor <id>', 'Actor ID')
    .option('--result <result>', 'Result filter')
    .option('-s, --search <text>', 'Search')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .option('--json <json>', 'Full JSON body')
    .action(async (opts) => {
      try {
        let dto: any;
        if (opts.json) {
          dto = parseJsonInput(opts.json);
        } else {
          dto = {
            exportName: opts.name,
            eventTypes: opts.eventTypes,
            actorId: opts.actor,
            result: opts.result,
            search: opts.search,
            startDate: opts.from,
            endDate: opts.to,
          };
        }
        const data = await getClient().exportAuditLogs(dto);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  audit
    .command('preview')
    .description('Preview audit log export')
    .option('--event-types <types...>', 'Event types')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .option('--json <json>', 'Full JSON body')
    .action(async (opts) => {
      try {
        let dto: any;
        if (opts.json) {
          dto = parseJsonInput(opts.json);
        } else {
          dto = {
            eventTypes: opts.eventTypes,
            startDate: opts.from,
            endDate: opts.to,
          };
        }
        const data = await getClient().previewAuditExport(dto);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  audit
    .command('exports')
    .description('List export history')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .option('--status <status>', 'Status filter (pending|processing|completed|failed)')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .action(async (opts) => {
      try {
        const data = await getClient().getExportHistory({
          page: parseInt(opts.page),
          perPage: parseInt(opts.limit),
          status: opts.status,
          startDate: opts.from,
          endDate: opts.to,
        });
        outputList(data, 'exports');
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  audit
    .command('download <exportId>')
    .description('Download an export')
    .action(async (exportId: string) => {
      try {
        const data = await getClient().downloadExport(exportId);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  audit
    .command('delete-export <exportId>')
    .description('Delete an export')
    .action(async (exportId: string) => {
      try {
        const data = await getClient().deleteExport(exportId);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });
}
