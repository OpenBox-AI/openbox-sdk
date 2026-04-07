import { Command } from 'commander';
import { getCoreClient } from '../config.js';
import { output } from '../output.js';
import { parseJsonInput } from '../input.js';
import { buildTestPayload, type SpanType } from '../span-builder.js';

export function registerCoreCommands(program: Command) {
  const core = program.command('core').description('Core governance API');

  core
    .command('health')
    .description('Check core API health')
    .action(async () => {
      try {
        const data = await getCoreClient().health();
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  core
    .command('validate')
    .description('Validate API key')
    .action(async () => {
      try {
        const data = await getCoreClient().validateApiKey();
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  core
    .command('evaluate')
    .description('Evaluate a governance event (raw JSON or --type shorthand)')
    .option('--json <json>', 'GovernanceEventPayload as JSON (raw mode)')
    .option('--type <type>', 'Span type shorthand: llm, file_read, file_write, shell, http, db, mcp')
    .option('--prompt <text>', 'Prompt text (for --type llm)')
    .option('--model <model>', 'Model name (for --type llm)')
    .option('--file-path <path>', 'File path (for --type file_read/file_write)')
    .option('--content <text>', 'File content (for --type file_read/file_write)')
    .option('--command <cmd>', 'Shell command (for --type shell)')
    .option('--cwd <dir>', 'Working directory (for --type shell)')
    .option('--method <method>', 'HTTP method (for --type http)')
    .option('--url <url>', 'HTTP URL (for --type http)')
    .option('--db-system <system>', 'Database system (for --type db)')
    .option('--db-operation <op>', 'Database operation (for --type db)')
    .option('--db-statement <sql>', 'SQL statement (for --type db)')
    .option('--tool-name <name>', 'MCP tool name (for --type mcp)')
    .option('--server <name>', 'MCP server name (for --type mcp)')
    .option('--tool-input <input>', 'MCP tool input (for --type mcp)')
    .option('--show-payload', 'Print the constructed payload instead of evaluating')
    .action(async (opts) => {
      try {
        let payload: any;

        if (opts.json) {
          payload = parseJsonInput<any>(opts.json);
        } else if (opts.type) {
          const validTypes = ['llm', 'file_read', 'file_write', 'shell', 'http', 'db', 'mcp'];
          if (!validTypes.includes(opts.type)) {
            console.error(`Invalid --type: ${opts.type}. Must be one of: ${validTypes.join(', ')}`);
            process.exit(1);
          }
          payload = buildTestPayload({
            type: opts.type as SpanType,
            prompt: opts.prompt,
            model: opts.model,
            filePath: opts.filePath,
            content: opts.content,
            command: opts.command,
            cwd: opts.cwd,
            method: opts.method,
            url: opts.url,
            dbSystem: opts.dbSystem,
            dbOperation: opts.dbOperation,
            dbStatement: opts.dbStatement,
            toolName: opts.toolName,
            server: opts.server,
            toolInput: opts.toolInput,
          });
        } else {
          console.error('Either --json or --type is required');
          process.exit(1);
        }

        if (opts.showPayload) {
          output(payload);
          return;
        }

        const data = await getCoreClient().evaluate(payload);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  core
    .command('poll-approval')
    .description('Poll approval status')
    .requiredOption('--workflow-id <id>', 'Workflow ID')
    .requiredOption('--run-id <id>', 'Run ID')
    .requiredOption('--activity-id <id>', 'Activity ID')
    .action(async (opts) => {
      try {
        const data = await getCoreClient().pollApproval({
          workflow_id: opts.workflowId,
          run_id: opts.runId,
          activity_id: opts.activityId,
        });
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });
}
