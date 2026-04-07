import { Command } from 'commander';
import { getCoreClient } from '../config.js';
import { output } from '../output.js';
import { parseJsonInput } from '../input.js';

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
    .description('Evaluate a governance event')
    .requiredOption('--json <json>', 'GovernanceEventPayload as JSON')
    .action(async (opts) => {
      try {
        const payload = parseJsonInput<any>(opts.json);
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
