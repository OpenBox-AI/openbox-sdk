import { readFileSync } from 'fs';
import { Command } from 'commander';
import { getClient } from '../config.js';
import { output, outputList } from '../output.js';
import { parseJsonInput } from '../input.js';
import {
  reportAndExit,
  validateRegoSource,
  validateEnum,
  validateInt,
  block,
  parsePagination,
  validateIsoDate,
} from '../validators/index.js';

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
          ...parsePagination(opts),
        });
        outputList(data, 'policies');
      } catch (err: any) {
        reportAndExit(err);
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
        let regoCode: string;
        if (opts.json) {
          dto = parseJsonInput(opts.json);
          regoCode = dto.rego_code;
          if (!regoCode && (opts.rego || opts.regoFile)) {
            // Allow --rego/--rego-file to fill rego_code if --json omits it.
            regoCode = opts.rego || readFileSync(opts.regoFile, 'utf-8');
            dto.rego_code = regoCode;
          }
        } else {
          if (!opts.rego && !opts.regoFile) {
            block('rego-required', 'Policy requires --rego <code> or --rego-file <path>.', 'Provide the Rego source one of two ways.');
          }
          if (opts.rego && opts.regoFile) {
            block('rego-conflict', 'Pass only one of --rego and --rego-file, not both.');
          }
          regoCode = opts.rego || readFileSync(opts.regoFile, 'utf-8');
          dto = {
            name: opts.name,
            description: opts.desc,
            rego_code: regoCode,
            input: opts.input ? JSON.parse(opts.input) : {},
            trust_impact: opts.trustImpact,
            trust_threshold: opts.trustThreshold ? parseInt(opts.trustThreshold) : undefined,
          };
        }

        // Validate the Rego source before POSTing. Catches deny[msg], missing result, invalid
        // decision enums, and warns about package-name rewrite.
        validateRegoSource(regoCode);
        if (opts.trustImpact) validateEnum(opts.trustImpact, ['none', 'low', 'medium', 'high'] as const, '--trust-impact');
        if (opts.trustThreshold) validateInt(opts.trustThreshold, '--trust-threshold', { min: 0, max: 100 });

        const data = await getClient().createPolicy(agentId, dto);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
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
        reportAndExit(err);
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
        reportAndExit(err);
      }
    });

  policy
    .command('update <agentId> <policyId>')
    .description(
      'Toggle active / roll back a policy version. Rego is immutable - use `policy create` to rotate.',
    )
    .option('--active <bool>', 'Active status (true|false) - required unless using --json')
    .option('--trust-impact <impact>', 'Trust impact (none|low|medium|high)')
    .option('--trust-threshold <n>', 'Trust threshold')
    .option('--json <json>', 'Full JSON body (must include is_active)')
    .action(async (agentId: string, policyId: string, opts) => {
      try {
        let dto: any;
        if (opts.json) {
          dto = parseJsonInput(opts.json);
          if (typeof dto.is_active !== 'boolean') {
            throw new Error(
              '--json body must include "is_active": true|false - backend requires it',
            );
          }
          if ('rego_code' in dto) {
            throw new Error(
              'rego_code is immutable after creation - run `openbox policy create` to rotate the policy instead',
            );
          }
        } else {
          if (opts.active !== 'true' && opts.active !== 'false') {
            throw new Error(
              '--active is required and must be "true" or "false". Pass --json for a raw body.',
            );
          }
          dto = { is_active: opts.active === 'true' };
          if (opts.trustImpact) dto.trust_impact = opts.trustImpact;
          if (opts.trustThreshold) dto.trust_threshold = parseInt(opts.trustThreshold);
        }
        const data = await getClient().updatePolicy(agentId, policyId, dto);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
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
          ...parsePagination(opts),
        });
        outputList(data, 'evaluations');
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  policy
    .command('metrics <agentId>')
    .description('Get policy metrics')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .action(async (agentId: string, opts) => {
      try {
        if (opts.from) validateIsoDate(opts.from, '--from');
        if (opts.to) validateIsoDate(opts.to, '--to');
        const data = await getClient().getPolicyMetrics(agentId, {
          fromTime: opts.from,
          toTime: opts.to,
        });
        output(data);
      } catch (err: any) {
        reportAndExit(err);
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
        reportAndExit(err);
      }
    });
}
