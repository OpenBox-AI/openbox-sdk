// `openbox violation` - list / agent are spec-driven via H.3. The
// false-positive write needs a custom call shape (3 positionals + a
// body) that wireSubcommands doesn't yet handle, so it stays
// hand-coded below.
import { Command } from 'commander';
import { getClient } from '../config.js';
import { output } from '../output.js';
import { reportAndExit, validateEnum } from '../validators/index.js';
import { wireSubcommands } from '../wire-subcommands.js';
import { VIOLATION_HANDLERS } from '../generated/cli-handlers/violation.js';

const VIOLATION_SOURCE_TYPES = ['behavior', 'guardrail', 'policy'] as const;

export function registerViolationCommands(program: Command) {
  const violation = program.command('violation').description('Violation management');
  wireSubcommands(violation, VIOLATION_HANDLERS, getClient as never);

  // Custom: backend signature is markFalsePositive(agentId, violationId,
  // { sourceType }) - three positionals plus a body. Spec-driven shapes
  // don't cover this hybrid yet.
  violation
    .command('false-positive <agentId> <violationId> <sourceType>')
    .description(
      `Mark a violation as false positive. sourceType must be one of: ${VIOLATION_SOURCE_TYPES.join('|')}`,
    )
    .action(async (agentId: string, violationId: string, sourceType: string) => {
      try {
        validateEnum(sourceType, VIOLATION_SOURCE_TYPES, '<sourceType>');
        const data = await getClient().markFalsePositive(agentId, violationId, { sourceType });
        output(data);
      } catch (err) {
        reportAndExit(err);
      }
    });
}
