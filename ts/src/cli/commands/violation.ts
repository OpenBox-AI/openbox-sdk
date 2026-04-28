// `openbox violation` - fully spec-driven (H.3 + H.9). false-positive
// uses the hybrid call shape (@cli_body_key on `sourceType` positional),
// list/agent are stable spec-driven reads.
import { Command } from 'commander';
import { getClient } from '../config.js';
import { wireSubcommands } from '../wire-subcommands.js';
import { VIOLATION_HANDLERS } from '../generated/cli-handlers/violation.js';

export function registerViolationCommands(program: Command) {
  const violation = program.command('violation').description('Violation management');
  wireSubcommands(violation, VIOLATION_HANDLERS, getClient as never);
}
