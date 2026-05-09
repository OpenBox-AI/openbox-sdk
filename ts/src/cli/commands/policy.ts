// `openbox policy`; fully spec-driven (H.3 + I + J). create/update
// use @cli_post_validate("policyCrossField") to run validateRegoSource
// before the call. evaluate stays custom because it takes raw rego
// + input JSON via different param names than the canonical body map.
import { Command } from 'commander';
import { getClient } from '../config.js';
import { output } from '../output.js';
import { reportAndExit } from '../../validators/index.js';
import { wireSubcommands } from '../wire-subcommands.js';
import { wireRecipes } from '../recipes.js';
import { POLICY_HANDLERS } from '../generated/cli-handlers/policy.js';
import { POLICY_RECIPES } from '../generated/cli-recipes/policy.js';

export function registerPolicyCommands(program: Command) {
  const policy = program.command('policy').description('Policy management');
  wireSubcommands(policy, POLICY_HANDLERS, getClient as never);
  wireRecipes(policy, POLICY_RECIPES, getClient as never);

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
      } catch (err) {
        reportAndExit(err);
      }
    });
}
