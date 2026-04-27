import { Command } from 'commander';
import { getClient } from '../config.js';
import { output, outputList } from '../output.js';
import { reportAndExit, validateEnum, parsePagination } from '../validators/index.js';

// Backend `MarkFalsePositiveDto.sourceType` is an enum over these three.
// Validating locally produces a clearer error than a backend 400.
const VIOLATION_SOURCE_TYPES = ['behavior', 'guardrail', 'policy'] as const;

export function registerViolationCommands(program: Command) {
  const violation = program.command('violation').description('Violation management');

  violation
    .command('list')
    .description('Get all violations')
    .action(async () => {
      try {
        const data = await getClient().getAllViolations();
        outputList(data, 'violations');
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  violation
    .command('agent <agentId>')
    .description('Get violations for an agent')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .option('--pattern <pattern>', 'Pattern filter')
    .option(
      '--source-type <type>',
      `Source type filter (${VIOLATION_SOURCE_TYPES.join('|')})`,
    )
    .action(async (agentId: string, opts) => {
      try {
        if (opts.sourceType) {
          validateEnum(opts.sourceType, VIOLATION_SOURCE_TYPES, '--source-type');
        }
        // Backend controller is `@Body()` on a GET route (non-spec). Node's
        // fetch forbids GET-with-body, so the client now sends filters as
        // query params instead - but the backend doesn't read them. Until
        // the backend switches to `@Query()`, warn the user that filter
        // flags are silently ignored rather than letting them think they
        // worked.
        if (opts.pattern || opts.sourceType) {
          console.error(
            "warning: --pattern / --source-type are accepted but currently ignored by the backend " +
              "(GET /agent/:id/violations reads filters from @Body(), which HTTP GET can't carry). " +
              "The full list is returned; filter client-side until the backend is fixed.",
          );
        }
        const data = await getClient().getAgentViolations(agentId, {
          ...parsePagination(opts),
          pattern: opts.pattern,
          sourceType: opts.sourceType,
        });
        outputList(data, 'violations');
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  violation
    .command('false-positive <agentId> <violationId> <sourceType>')
    .description(
      `Mark a violation as false positive. sourceType must be one of: ${VIOLATION_SOURCE_TYPES.join('|')}`,
    )
    .action(async (agentId: string, violationId: string, sourceType: string) => {
      try {
        validateEnum(sourceType, VIOLATION_SOURCE_TYPES, '<sourceType>');
        const data = await getClient().markFalsePositive(agentId, violationId, sourceType);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });
}
