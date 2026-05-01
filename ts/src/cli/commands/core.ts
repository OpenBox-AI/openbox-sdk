// `openbox core`; health/validate/poll-approval are spec-driven via
// the same wireSubcommands path that other commands use, but with the
// CoreClient resolver instead of OpenBoxClient. evaluate stays custom
// because it has the --type shorthand that drives buildTestPayload +
// the --show-payload "skip the call, just print" mode.
import { readFileSync, existsSync } from 'fs';
import { Command } from 'commander';
import { getCoreClient } from '../config.js';
import { output } from '../output.js';
import { parseJsonInput } from '../../validators/index.js';
import { buildTestPayload, SPAN_TYPES, type SpanType } from '../../test-utils/index.js';
import { reportAndExit } from '../../validators/index.js';
import { EXIT, bailWith } from '../exit-codes.js';
import { wireSubcommands } from '../wire-subcommands.js';
import { CORE_HANDLERS } from '../generated/cli-handlers/core.js';

function resolveValue(value: string | undefined): string | undefined {
  if (!value || !value.startsWith('@')) return value;
  const filePath = value.slice(1);
  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    bailWith(EXIT.USAGE);
  }
  return readFileSync(filePath, 'utf-8');
}

export function registerCoreCommands(program: Command) {
  const core = program.command('core').description('Core governance API');
  wireSubcommands(core, CORE_HANDLERS, getCoreClient as never);

  core
    .command('evaluate')
    .description('Evaluate a governance event (raw JSON or --type shorthand)')
    .option('--json <json>', 'GovernanceEventPayload as JSON (raw mode)')
    .option('--type <type>', 'Span type shorthand: llm, file_read, file_write, shell, http, db, mcp')
    .option('--activity-type <name>', 'Override activity_type (default depends on --type, e.g. PromptSubmission, FileRead)')
    .option('--prompt <text>', 'Prompt text, or @file.txt to read from file (for --type llm)')
    .option('--model <model>', 'Model name (for --type llm)')
    .option('--file-path <path>', 'File path (for --type file_read/file_write)')
    .option('--content <text>', 'File content, or @file.txt to read from file. Auto-reads --file-path if omitted.')
    .option('--command <cmd>', 'Shell command, or @script.sh to read from file (for --type shell)')
    .option('--cwd <dir>', 'Working directory (for --type shell)')
    .option('--method <method>', 'HTTP method (for --type http)')
    .option('--url <url>', 'HTTP URL (for --type http)')
    .option('--db-system <system>', 'Database system (for --type db)')
    .option('--db-operation <op>', 'Database operation (for --type db)')
    .option('--db-statement <sql>', 'SQL statement, or @query.sql to read from file (for --type db)')
    .option('--tool-name <name>', 'MCP tool name (for --type mcp)')
    .option('--server <name>', 'MCP server name (for --type mcp)')
    .option('--tool-input <input>', 'MCP tool input, or @input.json to read from file (for --type mcp)')
    .option('--show-payload', 'Print the constructed payload instead of evaluating')
    .option('--hook', 'Set hook_trigger=true (per the official temporal-sdk-python: only hook_governance.py-style events do this; activity-level events do NOT). Default false matches the activity-interceptor convention.')
    .action(async (opts) => {
      try {
        let payload: any;

        if (opts.json) {
          payload = parseJsonInput<any>(opts.json);
        } else if (opts.type) {
          if (!(SPAN_TYPES as readonly string[]).includes(opts.type)) {
            console.error(`Invalid --type: ${opts.type}. Must be one of: ${SPAN_TYPES.join(', ')}`);
            bailWith(EXIT.USAGE);
          }
          const prompt = resolveValue(opts.prompt);
          const content = resolveValue(opts.content);
          const command = resolveValue(opts.command);
          const dbStatement = resolveValue(opts.dbStatement);
          const toolInput = resolveValue(opts.toolInput);
          let fileContent = content;
          if (!fileContent && opts.filePath && (opts.type === 'file_read' || opts.type === 'file_write')) {
            if (existsSync(opts.filePath)) fileContent = readFileSync(opts.filePath, 'utf-8');
          }
          payload = buildTestPayload({
            type: opts.type as SpanType,
            activityType: opts.activityType,
            hookTrigger: opts.hook,
            prompt,
            model: opts.model,
            filePath: opts.filePath,
            content: fileContent,
            command,
            cwd: opts.cwd,
            method: opts.method,
            url: opts.url,
            dbSystem: opts.dbSystem,
            dbOperation: opts.dbOperation,
            dbStatement,
            toolName: opts.toolName,
            server: opts.server,
            toolInput,
          });
        } else {
          console.error('Either --json or --type is required');
          bailWith(EXIT.USAGE);
        }

        if (opts.showPayload) {
          output(payload);
          return;
        }

        const data = await getCoreClient().evaluate(payload);
        output(data);
      } catch (err) {
        reportAndExit(err);
      }
    });
}
