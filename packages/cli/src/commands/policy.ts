import { readFileSync } from 'fs';
import { Command } from 'commander';
import { getClient } from '../config.js';
import { output, outputList } from '../output.js';
import { parseJsonInput } from '../input.js';

export function registerPolicyCommands(program: Command) {
  const policy = program.command('policy').description('Policy management');

  policy
    .command('list <agentId>')
    .description('List policies for an agent')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .action(async (agentId: string, opts) => {
      try {
        const data = await getClient().listPolicies(agentId, {
          page: parseInt(opts.page),
          perPage: parseInt(opts.limit),
        });
        outputList(data, 'policies');
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  policy
    .command('create <agentId>')
    .description('Create a policy')
    .requiredOption('-n, --name <name>', 'Policy name')
    .option('-d, --desc <text>', 'Description')
    .option('--rego <code>', 'Rego policy code')
    .option('--rego-file <path>', 'Read rego code from file')
    .option('--input <json>', 'Input JSON for policy')
    .option('--trust-impact <impact>', 'Trust impact (none|low|medium|high)')
    .option('--trust-threshold <n>', 'Trust threshold')
    .option('--json <json>', 'Full JSON body (overrides other options)')
    .action(async (agentId: string, opts) => {
      try {
        let dto: any;
        if (opts.json) {
          dto = parseJsonInput(opts.json);
        } else {
          let regoCode = opts.rego || '';
          if (opts.regoFile) {
            regoCode = readFileSync(opts.regoFile, 'utf-8');
          }
          dto = {
            name: opts.name,
            description: opts.desc,
            rego_code: regoCode,
            input: opts.input ? JSON.parse(opts.input) : {},
            trust_impact: opts.trustImpact,
            trust_threshold: opts.trustThreshold ? parseInt(opts.trustThreshold) : undefined,
          };
        }
        const data = await getClient().createPolicy(agentId, dto);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  policy
    .command('current <agentId>')
    .description('Get current active policies')
    .action(async (agentId: string) => {
      try {
        const data = await getClient().getCurrentPolicies(agentId);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  policy
    .command('get <agentId> <policyId>')
    .description('Get policy details')
    .action(async (agentId: string, policyId: string) => {
      try {
        const data = await getClient().getPolicy(agentId, policyId);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  policy
    .command('update <agentId> <policyId>')
    .description('Update a policy')
    .option('--active <bool>', 'Active status (true|false)')
    .option('--trust-impact <impact>', 'Trust impact (none|low|medium|high)')
    .option('--trust-threshold <n>', 'Trust threshold')
    .option('--json <json>', 'Full JSON body')
    .action(async (agentId: string, policyId: string, opts) => {
      try {
        let dto: any;
        if (opts.json) {
          dto = parseJsonInput(opts.json);
        } else {
          dto = {
            is_active: opts.active === 'true',
          } as any;
          if (opts.trustImpact) dto.trust_impact = opts.trustImpact;
          if (opts.trustThreshold) dto.trust_threshold = parseInt(opts.trustThreshold);
        }
        const data = await getClient().updatePolicy(agentId, policyId, dto);
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  policy
    .command('evaluations <agentId> <policyId>')
    .description('Get policy evaluations')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .action(async (agentId: string, policyId: string, opts) => {
      try {
        const data = await getClient().getPolicyEvaluations(agentId, policyId, {
          page: parseInt(opts.page),
          perPage: parseInt(opts.limit),
        });
        outputList(data, 'evaluations');
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  policy
    .command('metrics <agentId>')
    .description('Get policy metrics')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .action(async (agentId: string, opts) => {
      try {
        const data = await getClient().getPolicyMetrics(agentId, {
          fromTime: opts.from,
          toTime: opts.to,
        });
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  policy
    .command('evaluate')
    .description('Evaluate a rego policy')
    .requiredOption('--rego <code>', 'Rego policy code')
    .requiredOption('--input <json>', 'Input JSON')
    .action(async (opts) => {
      try {
        const data = await getClient().evaluateRego({
          policy: opts.rego,
          input: JSON.parse(opts.input),
        });
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });
}
