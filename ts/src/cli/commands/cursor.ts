import { Command } from 'commander';
import { EXIT, bailWith } from '../exit-codes.js';
import { error, info, success, output } from '../output.js';

/** `openbox cursor hook`: stdin → governance → stdout, invoked by
 *  Cursor per hook event. Install lives at `openbox install cursor`. */
export function registerCursorCommands(program: Command) {
  const cursor = program.command('cursor').description('Cursor IDE integration');

  cursor
    .command('hook')
    .description('Run the OpenBox hook handler (invoked by Cursor per hook event)')
    .action(async () => {
      const { runCursorHook } = await import('../../runtime/cursor/hook-handler.js');
      try {
        await runCursorHook();
      } catch (err) {
        // Fail-open: unhandled error → Cursor uses default permissioning.
        error(`cursor hook: ${(err as Error).message}`);
        bailWith(EXIT.OK);
      }
    });

  cursor
    .command('harden')
    .description(
      'Apply an OpenBox enterprise profile to ~/.cursor/User/settings.json ' +
        '(privacy mode on, cloud features off, telemetry off). Idempotent. ' +
        'Reverse with `openbox cursor unharden`.',
    )
    .option('--profile <name>', 'Profile to apply', 'enterprise-default')
    .option('--dry-run', 'Print what would change without writing', false)
    .action(async (opts: { profile: string; dryRun: boolean }) => {
      const { hardenCursor } = await import('../../runtime/cursor/enterprise.js');
      try {
        const r = hardenCursor({
          profile: opts.profile as 'enterprise-default' | 'enterprise-strict',
          dryRun: opts.dryRun,
        });
        const verb = opts.dryRun ? 'would apply' : 'applied';
        success(`profile '${r.profile}' ${verb} to ${r.file}`);
        if (r.applied.length) info(`  applied:   ${r.applied.join(', ')}`);
        if (r.unchanged.length) info(`  unchanged: ${r.unchanged.length} key(s)`);
      } catch (err) {
        error(`cursor harden: ${(err as Error).message}`);
        bailWith(EXIT.GENERIC);
      }
    });

  cursor
    .command('unharden')
    .description('Remove the OpenBox enterprise profile from ~/.cursor/User/settings.json')
    .action(async () => {
      const { unhardenCursor } = await import('../../runtime/cursor/enterprise.js');
      const r = unhardenCursor();
      success(`removed ${r.removed.length} OpenBox-managed key(s) from ${r.file}`);
    });

  cursor
    .command('sync-rules')
    .description(
      "Render an agent's live guardrails and policies into .cursor/rules/ " +
        'so the agent self-restricts up-front (rather than discovering policy ' +
        'by tripping a hook). Reruns are idempotent and prune stale OpenBox ' +
        'rule files.',
    )
    .requiredOption('--agent <id>', 'Agent ID to project rules from')
    .option('--workspace <path>', 'Workspace root', process.cwd())
    .option('--dry-run', 'Print what would be written without touching disk', false)
    .option('--no-prune', 'Skip removing OpenBox-managed rule files no longer in projection')
    .action(
      async (opts: {
        agent: string;
        workspace: string;
        dryRun: boolean;
        prune: boolean;
      }) => {
        const { fetchRulesProjection } = await import(
          '../../runtime/_shared/rules-projection.js'
        );
        const { renderRulesProjection } = await import('../../runtime/cursor/rules.js');
        try {
          const projection = await fetchRulesProjection({ agentId: opts.agent });
          if (opts.dryRun) {
            output(projection);
            return;
          }
          const result = renderRulesProjection(projection, {
            workspace: opts.workspace,
            noPrune: !opts.prune,
          });
          success(`synced ${projection.rules.length} rule(s) to ${result.rulesDir}`);
          if (result.written.length > 0) {
            info(`  written: ${result.written.length} (${result.written.slice(0, 3).join(', ')}${result.written.length > 3 ? '…' : ''})`);
          }
          if (result.pruned.length > 0) {
            info(`  pruned:  ${result.pruned.length}`);
          }
        } catch (err) {
          error(`cursor sync-rules: ${(err as Error).message}`);
          bailWith(EXIT.GENERIC);
        }
      },
    );
}
