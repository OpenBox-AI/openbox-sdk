// Org-level webhook management. Wraps the WebhookController surface
// (POST/GET/PATCH/DELETE /webhook + the test/regenerate-secret/
// deliveries side-endpoints). Generated wrapper methods come from
// codegen/method-names.json:
//   listWebhooks, createWebhook, getWebhook, updateWebhook,
//   deleteWebhook, testWebhook, regenerateWebhookSecret,
//   getWebhookDeliveries.

import { Command } from 'commander';
import { getClient } from '../config.js';
import { output, outputList } from '../output.js';
import { parseJsonInput } from '../input.js';
import { reportAndExit, parsePagination } from '../validators/index.js';

export function registerWebhookCommands(program: Command) {
  const webhook = program.command('webhook').description('Webhook management');

  webhook
    .command('list')
    .description('List webhooks for the current org')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .action(async (opts) => {
      try {
        const data = await getClient().listWebhooks(parsePagination(opts));
        outputList(data, 'webhooks');
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  webhook
    .command('create')
    .description('Create a webhook')
    .requiredOption('--json <json>', 'Webhook config (CreateWebhookDto)')
    .action(async (opts) => {
      try {
        const data = await getClient().createWebhook(parseJsonInput(opts.json));
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  webhook
    .command('get <id>')
    .description('Get a webhook by id')
    .action(async (id: string) => {
      try {
        const data = await getClient().getWebhook(id);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  webhook
    .command('update <id>')
    .description('Update a webhook')
    .requiredOption('--json <json>', 'Update body (UpdateWebhookDto)')
    .action(async (id: string, opts) => {
      try {
        const data = await getClient().updateWebhook(id, parseJsonInput(opts.json));
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  webhook
    .command('delete <id>')
    .description('Delete a webhook')
    .action(async (id: string) => {
      try {
        const data = await getClient().deleteWebhook(id);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  webhook
    .command('test <id>')
    .description('Send a test event to the webhook')
    .action(async (id: string) => {
      try {
        const data = await getClient().testWebhook(id);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  webhook
    .command('regenerate-secret <id>')
    .description('Rotate the signing secret for the webhook')
    .action(async (id: string) => {
      try {
        const data = await getClient().regenerateWebhookSecret(id);
        output(data);
        const secret = (data as { secret?: string } | null)?.secret;
        if (typeof secret === 'string') {
          console.error('');
          console.error('────────────────────────────────────────────────────────────');
          console.error('  New webhook signing secret (capture now - shown once):');
          console.error(`    ${secret}`);
          console.error('────────────────────────────────────────────────────────────');
        }
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  webhook
    .command('deliveries <id>')
    .description('List deliveries for a webhook')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .action(async (id: string, opts) => {
      try {
        const data = await getClient().getWebhookDeliveries(id, parsePagination(opts));
        outputList(data, 'webhook deliveries');
      } catch (err: any) {
        reportAndExit(err);
      }
    });
}
