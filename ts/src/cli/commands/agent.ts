// `openbox agent`; list / get / delete / update / create are all
// spec-driven (H.3 + I + J). create uses @cli_dto_defaults for the
// AIVSS baseline, @cli_preflight("agentCreatePreflight") for the
// team-existence + name-collision GETs, and @cli_output_post(
// "highlightRuntimeKey") for the one-time stderr key highlight.
//
// `audit` keeps a custom shell because the report renderer and
// pagination-walking aggregation across sessions don't fit the
// canonical CLI contract.
import { Command } from 'commander';
import { getClient } from '../config.js';
import { reportAndExit } from '../../validators/index.js';
import { EXIT, bailWith } from '../exit-codes.js';
import { output } from '../output.js';
import { runAgentAudit, renderAuditReport, auditHasIssues } from './agent-audit.js';
import { wireSubcommands } from '../wire-subcommands.js';
import { AGENT_HANDLERS } from '../generated/cli-handlers/agent.js';

export function registerAgentCommands(program: Command) {
  const agent = program.command('agent').description('Agent management');
  wireSubcommands(agent, AGENT_HANDLERS, getClient as never);

  agent
    .command('audit <agentId>')
    .description('Cross-session health report: status mix, protocol pairing, verdict / activity_type distribution, guardrail↔event mismatches')
    .option('--sessions <n>', 'Number of recent sessions to analyze', '50')
    .option('--max-events <n>', 'Cap events fetched per session', '500')
    .option('--json', 'Emit the report as JSON instead of human-readable', false)
    .action(async (agentId: string, opts) => {
      try {
        const report = await runAgentAudit(getClient(), agentId, {
          sessions: parseInt(opts.sessions, 10),
          maxEvents: parseInt(opts.maxEvents, 10),
        });
        if (opts.json) output(report);
        else renderAuditReport(agentId, report);
        if (auditHasIssues(report)) bailWith(EXIT.GENERIC);
      } catch (err) {
        reportAndExit(err);
      }
    });
}
