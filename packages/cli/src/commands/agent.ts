import { Command } from 'commander';
import { getClient } from '../config.js';
import { output, outputList } from '../output.js';
import { parseJsonInput } from '../input.js';

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
          page: parseInt(opts.page),
          perPage: parseInt(opts.limit),
          search: opts.search,
          status: opts.status ? parseInt(opts.status) : undefined,
          team_id: opts.team,
          tiers: opts.tiers,
        });
        outputList(data, 'agents');
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  agent
    .command('create')
    .description('Create a new agent')
    .requiredOption('-n, --name <name>', 'Agent name')
    .option('-d, --desc <text>', 'Description')
    .option('-t, --team <ids...>', 'Team IDs')
    .option('--type <type>', 'Agent type', 'temporal')
    .option('--icon <icon>', 'Icon', 'robot')
    .option('--json <json>', 'Full JSON body (overrides other options)')
    .action(async (opts) => {
      try {
        const client = getClient();
        let dto: any;
        if (opts.json) {
          dto = parseJsonInput(opts.json);
        } else {
          dto = {
            agent_name: opts.name,
            description: opts.desc,
            team_ids: opts.team || [],
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
        console.error(err.message || err);
        process.exit(1);
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
        console.error(err.message || err);
        process.exit(1);
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
        console.error(err.message || err);
        process.exit(1);
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
        console.error(err.message || err);
        process.exit(1);
      }
    });
}
