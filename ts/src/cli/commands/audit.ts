// `openbox audit`; fully spec-driven (H.3 + I + K). list/exports/get
// are reads, delete-export/preview/export use @cli_json_merge for
// body construction, download uses @cli_output_kind("binary") to
// pass the binary payload through to stdout verbatim.
import { Command } from 'commander';
import { getClient } from '../config.js';
import { wireSubcommands } from '../wire-subcommands.js';
import { wireRecipes } from '../recipes.js';
import { AUDIT_HANDLERS } from '../generated/cli-handlers/audit.js';
import { AUDIT_RECIPES } from '../generated/cli-recipes/audit.js';

export function registerAuditCommands(program: Command) {
  const audit = program.command('audit').description('Audit log management');
  wireSubcommands(audit, AUDIT_HANDLERS, getClient as never);
  wireRecipes(audit, AUDIT_RECIPES, getClient as never);
}
