// `openbox webhook`; fully spec-driven (H.3 + I). regenerate-secret
// uses @cli_output_post("highlightWebhookSecret") for the one-time
// stderr highlight; everything else is canonical CRUD.
import { Command } from 'commander';
import { getClient } from '../config.js';
import { wireSubcommands } from '../wire-subcommands.js';
import { WEBHOOK_HANDLERS } from '../generated/cli-handlers/webhook.js';

export function registerWebhookCommands(program: Command) {
  const webhook = program.command('webhook').description('Webhook management');
  wireSubcommands(webhook, WEBHOOK_HANDLERS, getClient as never);
}
