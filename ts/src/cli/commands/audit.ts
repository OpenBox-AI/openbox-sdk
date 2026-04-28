// `openbox audit` - list / exports / delete-export / get are
// spec-driven (H.3). `export`, `preview`, and `download` keep custom
// shells: the first two need --json fallback merging with required-
// field validation, download returns a binary payload.
import { Command } from 'commander';
import { getClient } from '../config.js';
import { output } from '../output.js';
import { parseJsonInput } from '../input.js';
import { reportAndExit, validateEnum, validateIsoDate } from '../validators/index.js';
import { wireSubcommands } from '../wire-subcommands.js';
import { AUDIT_HANDLERS } from '../generated/cli-handlers/audit.js';

const AUDIT_EVENT_TYPES = [
  'policy_change', 'guardrail_change', 'agent_session',
  'agent_risk_configuration_change', 'agent_goal_alignment_configuration_change',
  'role_change', 'security_event', 'settings_update', 'team_management',
  'member_management', 'invitation',
] as const;
const AUDIT_RESULTS = ['success', 'failed', 'denied', 'warning', 'approved', 'allowed'] as const;

export function registerAuditCommands(program: Command) {
  const audit = program.command('audit').description('Audit log management');
  wireSubcommands(audit, AUDIT_HANDLERS, getClient as never);

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
        if (opts.eventTypes) for (const t of opts.eventTypes) validateEnum(t, AUDIT_EVENT_TYPES, '--event-types entry');
        if (opts.result) validateEnum(opts.result, AUDIT_RESULTS, '--result');
        if (opts.from) validateIsoDate(opts.from, '--from');
        if (opts.to) validateIsoDate(opts.to, '--to');

        const dto: any = opts.json ? parseJsonInput(opts.json) : {};
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
      } catch (err) {
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
        if (opts.eventTypes) for (const t of opts.eventTypes) validateEnum(t, AUDIT_EVENT_TYPES, '--event-types entry');
        if (opts.from) validateIsoDate(opts.from, '--from');
        if (opts.to) validateIsoDate(opts.to, '--to');
        const dto = opts.json
          ? parseJsonInput(opts.json)
          : { eventTypes: opts.eventTypes, startDate: opts.from, endDate: opts.to };
        const data = await getClient().previewAuditExport(dto);
        output(data);
      } catch (err) {
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
      } catch (err) {
        reportAndExit(err);
      }
    });
}
