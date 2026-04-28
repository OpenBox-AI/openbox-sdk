import { Command } from 'commander';
import { getClient } from '../config.js';
import { output, outputList } from '../output.js';
import { parseJsonInput } from '../input.js';
import { reportAndExit, parsePagination, validateEnum, validateIsoDate } from '../validators/index.js';

// Canonical enums from ts/types/src/requests.ts - kept in sync by hand.
// If the type union there changes, update these tuples too.
const AUDIT_EVENT_TYPES = [
  'policy_change',
  'guardrail_change',
  'agent_session',
  'agent_risk_configuration_change',
  'agent_goal_alignment_configuration_change',
  'role_change',
  'security_event',
  'settings_update',
  'team_management',
  'member_management',
  'invitation',
] as const;
const AUDIT_RESULTS = ['success', 'failed', 'denied', 'warning', 'approved', 'allowed'] as const;
const AUDIT_EXPORT_STATUSES = ['pending', 'processing', 'completed', 'failed'] as const;

export function registerAuditCommands(program: Command) {
  const audit = program.command('audit').description('Audit log management');

  audit
    .command('list')
    .description('List audit logs')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .option('--event-type <type>', `Event type filter (${AUDIT_EVENT_TYPES.join('|')})`)
    .option('--actor <id>', 'Actor ID filter')
    .option('--result <result>', `Result filter (${AUDIT_RESULTS.join('|')})`)
    .option('-s, --search <text>', 'Search')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .action(async (opts) => {
      try {
        if (opts.eventType) validateEnum(opts.eventType, AUDIT_EVENT_TYPES, '--event-type');
        if (opts.result) validateEnum(opts.result, AUDIT_RESULTS, '--result');
        if (opts.from) validateIsoDate(opts.from, '--from');
        if (opts.to) validateIsoDate(opts.to, '--to');
        const data = await getClient().getAuditLogs({
          ...parsePagination(opts),
          eventType: opts.eventType,
          actorId: opts.actor,
          result: opts.result,
          search: opts.search,
          startDate: opts.from,
          endDate: opts.to,
        });
        outputList(data, 'audit logs');
      } catch (err: any) {
        reportAndExit(err);
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
        reportAndExit(err);
      }
    });

  audit
    .command('export')
    .description('Export audit logs')
    .requiredOption('-n, --name <name>', 'Export name (required; if --json omits exportName, this fills it)')
    .option('--event-types <types...>', 'Event types')
    .option('--actor <id>', 'Actor ID')
    .option('--result <result>', 'Result filter')
    .option('-s, --search <text>', 'Search')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .option('--json <json>', 'Full JSON body (merged with flags - flags fill missing fields)')
    .action(async (opts) => {
      try {
        // Validate flag inputs before building the DTO - values inside --json
        // are the user's responsibility (they chose to hand-write a body).
        if (opts.eventTypes) {
          for (const t of opts.eventTypes) validateEnum(t, AUDIT_EVENT_TYPES, '--event-types entry');
        }
        if (opts.result) validateEnum(opts.result, AUDIT_RESULTS, '--result');
        if (opts.from) validateIsoDate(opts.from, '--from');
        if (opts.to) validateIsoDate(opts.to, '--to');

        // Merge flags over --json rather than letting --json wholesale replace
        // the DTO. Previously, passing --json silently dropped the required
        // --name, so the backend received a nameless body despite CLI claiming
        // --name was required. Now flags always fill missing fields.
        let dto: any = opts.json ? parseJsonInput(opts.json) : {};
        if (opts.name && !dto.exportName) dto.exportName = opts.name;
        if (opts.eventTypes && !dto.eventTypes) dto.eventTypes = opts.eventTypes;
        if (opts.actor && !dto.actorId) dto.actorId = opts.actor;
        if (opts.result && !dto.result) dto.result = opts.result;
        if (opts.search && !dto.search) dto.search = opts.search;
        if (opts.from && !dto.startDate) dto.startDate = opts.from;
        if (opts.to && !dto.endDate) dto.endDate = opts.to;
        if (!dto.exportName) {
          console.error('Error: exportName is required (pass --name or include it in --json).');
          process.exit(2);
        }
        const data = await getClient().exportAuditLogs(dto);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  audit
    .command('preview')
    .description('Preview audit log export')
    .option('--event-types <types...>', `Event types (${AUDIT_EVENT_TYPES.join('|')})`)
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .option('--json <json>', 'Full JSON body')
    .action(async (opts) => {
      try {
        if (opts.eventTypes) {
          for (const t of opts.eventTypes) validateEnum(t, AUDIT_EVENT_TYPES, '--event-types entry');
        }
        if (opts.from) validateIsoDate(opts.from, '--from');
        if (opts.to) validateIsoDate(opts.to, '--to');
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
        reportAndExit(err);
      }
    });

  audit
    .command('exports')
    .description('List export history')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .option('--status <status>', `Status filter (${AUDIT_EXPORT_STATUSES.join('|')})`)
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .action(async (opts) => {
      try {
        if (opts.status) validateEnum(opts.status, AUDIT_EXPORT_STATUSES, '--status');
        if (opts.from) validateIsoDate(opts.from, '--from');
        if (opts.to) validateIsoDate(opts.to, '--to');
        const data = await getClient().getExportHistory({
          ...parsePagination(opts),
          status: opts.status,
          startDate: opts.from,
          endDate: opts.to,
        });
        outputList(data, 'exports');
      } catch (err: any) {
        reportAndExit(err);
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
        reportAndExit(err);
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
        reportAndExit(err);
      }
    });
}
