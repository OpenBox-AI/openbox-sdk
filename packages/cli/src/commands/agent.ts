import { Command } from 'commander';
import { getClient } from '../config.js';
import { output, outputList } from '../output.js';
import { parseJsonInput } from '../input.js';
import { reportAndExit, validateUuid, warn, block, parsePagination } from '../validators/index.js';
import { runAgentAudit, renderAuditReport, auditHasIssues } from './agent-audit.js';

export function registerAgentCommands(program: Command) {
  const agent = program.command('agent').description('Agent management');

  agent
    .command('list')
    .description('List all agents')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .option('-s, --search <text>', 'Search by name')
    .option('--status <n>', 'Filter by status')
    .option('--team <id>', 'Filter by team ID')
    .option('--tiers <tiers...>', 'Filter by tiers')
    .action(async (opts) => {
      try {
        const data = await getClient().listAgents({
          ...parsePagination(opts),
          search: opts.search,
          status: opts.status ? parseInt(opts.status) : undefined,
          team_id: opts.team,
          tiers: opts.tiers,
        });
        outputList(data, 'agents');
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  agent
    .command('create')
    .description('Create a new agent')
    .requiredOption('-n, --name <name>', 'Agent name')
    .option('-d, --desc <text>', 'Description')
    .option('-t, --team <ids...>', 'Team IDs (UUIDs). Required - without it, the agent is orphaned and every call returns 403.')
    .option('--type <type>', 'Agent type', 'temporal')
    .option('--icon <icon>', 'Icon', 'robot')
    .option('--skip-preflight', 'Skip team-exists + name-conflict pre-flight GETs (faster but you own the failure mode)', false)
    .option('--json <json>', 'Full JSON body (overrides other options)')
    .action(async (opts) => {
      try {
        const client = getClient();
        let dto: any;
        if (opts.json) {
          dto = parseJsonInput(opts.json);
          // Validate team UUIDs on the json path too.
          if (Array.isArray(dto.team_ids)) dto.team_ids.forEach((id: unknown, i: number) => validateUuid(id, `team_ids[${i}]`));
        } else {
          const teams = opts.team || [];
          if (teams.length === 0) {
            block(
              'agent-missing-team',
              `Agent creation requires at least one team ID via -t/--team. Without it the agent is orphaned (403 on every subsequent call).`,
              `Resolve a teamId: \`openbox auth profile\` gives your orgId, then \`openbox team list <orgId>\` lists available teams.`,
              'references/commands.md § "agent create"',
            );
          }
          teams.forEach((id: string, i: number) => validateUuid(id, `--team[${i}]`));

          // Pre-flight: confirm each team exists and confirm no agent name collision.
          if (!opts.skipPreflight) {
            let orgId: string | undefined;
            try {
              const profile = await client.getProfile();
              orgId = (profile as any).orgId ?? (profile as any).org_id ?? (profile as any).user?.orgId;
            } catch {
              warn(`Pre-flight getProfile() failed - skipping team existence check. Pass --skip-preflight to silence this.`);
            }
            if (orgId) {
              for (const teamId of teams) {
                try {
                  await client.getTeam(orgId, teamId);
                } catch (e: any) {
                  const status = e?.status ?? e?.response?.status;
                  if (status === 404 || status === 403) {
                    block(
                      'team-not-found',
                      `Team ${teamId} does not exist or you lack access in org ${orgId}. Creating the agent now would orphan it (403 on every subsequent call).`,
                      `List accessible teams: \`openbox team list ${orgId}\`. Use --skip-preflight only if you're sure the team exists and this check is mis-reporting.`,
                    );
                  }
                  warn(`Pre-flight GET /team/${teamId} failed (${e.message}). Continuing; the create will fail if the team is missing.`);
                }
              }
            }
            try {
              const existing = await client.listAgents({ search: opts.name });
              const rows = (existing as any).data ?? existing;
              const arr = Array.isArray(rows) ? rows : (rows?.data ?? []);
              if (arr.some((a: any) => a.agent_name === opts.name)) {
                warn(`An agent named "${opts.name}" already exists in this org. The backend may accept duplicate names, but subsequent lookups by name will be ambiguous. Consider a unique name.`);
              }
            } catch { /* non-fatal */ }
          }

          dto = {
            agent_name: opts.name,
            description: opts.desc,
            team_ids: teams,
            agent_type: opts.type,
            icon: opts.icon,
            aivss_config: {
              base_security: {
                attack_vector: 2,
                attack_complexity: 1,
                privileges_required: 2,
                user_interaction: 1,
                scope: 1,
              },
              ai_specific: {
                model_robustness: 3,
                data_sensitivity: 2,
                ethical_impact: 2,
                decision_criticality: 2,
                adaptability: 3,
              },
              impact: {
                confidentiality_impact: 2,
                integrity_impact: 2,
                availability_impact: 2,
                safety_impact: 1,
              },
            },
          };
        }
        const data = await client.createAgent(dto);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  agent
    .command('get <agentId>')
    .description('Get agent details')
    .action(async (agentId: string) => {
      try {
        const data = await getClient().getAgent(agentId);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  agent
    .command('update <agentId>')
    .description('Update an agent')
    .option('-n, --name <name>', 'Agent name')
    .option('-d, --desc <text>', 'Description')
    .option('--type <type>', 'Agent type')
    .option('--model <model>', 'Model name')
    .option('--tags <tags...>', 'Tags')
    .option('--team <ids...>', 'Team IDs')
    .option('--json <json>', 'Full JSON body')
    .action(async (agentId: string, opts) => {
      try {
        let dto: any;
        if (opts.json) {
          dto = parseJsonInput(opts.json);
        } else {
          dto = {} as any;
          if (opts.name) dto.agent_name = opts.name;
          if (opts.desc) dto.description = opts.desc;
          if (opts.type) dto.agent_type = opts.type;
          if (opts.model) dto.model_name = opts.model;
          if (opts.tags) dto.tags = opts.tags;
          if (opts.team) dto.team_ids = opts.team;
        }
        const data = await getClient().updateAgent(agentId, dto);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  agent
    .command('delete <agentId>')
    .description('Delete an agent')
    .action(async (agentId: string) => {
      try {
        const data = await getClient().deleteAgent(agentId);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

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
        if (opts.json) console.log(JSON.stringify(report, null, 2));
        else renderAuditReport(agentId, report);
        if (auditHasIssues(report)) process.exit(2);
      } catch (err: any) {
        reportAndExit(err);
      }
    });
}
