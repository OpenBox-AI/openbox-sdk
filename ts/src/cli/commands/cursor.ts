import { Command } from 'commander';
import { EXIT, bailWith } from '../exit-codes.js';
import { error, info, row, success, summary, output } from '../output.js';
import { isMachineMode } from '../non-interactive.js';

function collectPair(value: string, prior: string[]): string[] {
  return [...prior, value];
}

/** `openbox cursor <subcommand>`:
 *
 *    hook         stdin to governance to stdout, invoked by Cursor
 *                 per hook event.
 *    install      write the hook block (and optionally the MCP
 *                 entry) at the chosen scope.
 *    uninstall    remove the same block.
 *    harden       apply the enterprise hardening profile.
 *    unharden     revert the hardening profile.
 *    sync-rules   render an agent's rules into .cursor/rules/.
 */
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
    .command('install')
    .description(
      'Install the Cursor hook block and (optionally) the MCP server ' +
        'entry. Use --scope project to scope to <cwd>.',
    )
    .option('--no-mcp', 'Skip the MCP server entry')
    .option('--scope <scope>', 'global | project', 'global')
    .option('--cwd <dir>', 'Project root for --scope project')
    .option(
      '--matcher <pair>',
      "Hook matcher pair `<event>=<regex>`. Repeatable.",
      collectPair,
      [],
    )
    .action(
      async (opts: {
        mcp?: boolean;
        scope?: string;
        cwd?: string;
        matcher: string[];
      }) => {
        const scope = (opts.scope ?? 'global').toLowerCase();
        if (scope !== 'global' && scope !== 'project') {
          error(`--scope: invalid value '${opts.scope}'; expected global or project`);
          bailWith(EXIT.USAGE);
        }
        const cwd = opts.cwd ?? process.cwd();
        const matchers: Record<string, string> = {};
        for (const pair of opts.matcher ?? []) {
          const idx = pair.indexOf('=');
          if (idx <= 0) {
            error(`--matcher: invalid pair '${pair}', expected <event>=<regex>`);
            bailWith(EXIT.USAGE);
          }
          matchers[pair.slice(0, idx).trim()] = pair.slice(idx + 1);
        }
        const { installCursor } = await import('../../runtime/cursor/install.js');
        installCursor({
          scope: scope as 'global' | 'project',
          cwd,
          matchers: Object.keys(matchers).length > 0 ? matchers : undefined,
        });
        if (opts.mcp !== false) {
          info('');
          const { installMcp } = await import('../../runtime/mcp/install.js');
          installMcp({
            targets: ['cursor'],
            scope: scope as 'global' | 'project',
            cwd,
          });
        }
      },
    );

  cursor
    .command('uninstall')
    .description('Remove the Cursor hook block and (optionally) the MCP entry')
    .option('--no-mcp', 'Skip removing the MCP server entry')
    .option('--scope <scope>', 'global | project', 'global')
    .option('--cwd <dir>', 'Project root for --scope project')
    .action(
      async (opts: { mcp?: boolean; scope?: string; cwd?: string }) => {
        const scope = (opts.scope ?? 'global').toLowerCase();
        if (scope !== 'global' && scope !== 'project') {
          error(`--scope: invalid value '${opts.scope}'; expected global or project`);
          bailWith(EXIT.USAGE);
        }
        const cwd = opts.cwd ?? process.cwd();
        const { uninstallCursor } = await import('../../runtime/cursor/install.js');
        uninstallCursor({ scope: scope as 'global' | 'project', cwd });
        if (opts.mcp !== false) {
          info('');
          const { uninstallMcp } = await import('../../runtime/mcp/install.js');
          uninstallMcp({
            targets: ['cursor'],
            scope: scope as 'global' | 'project',
            cwd,
          });
        }
      },
    );

  cursor
    .command('doctor')
    .description(
      'Verify the installed Cursor surface and hook runtime readiness.',
    )
    .option('--scope <scope>', 'global | project', 'global')
    .option('--cwd <dir>', 'Project root for --scope project')
    .option('--surface-only', 'Check installed files only; skip runtime key/core validation', false)
    .option('--no-core-validate', 'Check runtime config and key format without calling core')
    .option('--json', 'Emit machine-readable JSON', false)
    .action(async (opts: { scope?: string; cwd?: string; surfaceOnly?: boolean; coreValidate?: boolean; json?: boolean }) => {
      const scope = (opts.scope ?? 'global').toLowerCase();
      if (scope !== 'global' && scope !== 'project') {
        error(`--scope: invalid value '${opts.scope}'; expected global or project`);
        bailWith(EXIT.USAGE);
      }
      const { verifyCursorInstall } = await import('../../runtime/cursor/install.js');
      const checks = await verifyCursorInstall(
        opts.surfaceOnly
          ? {
              scope: scope as 'global' | 'project',
              cwd: opts.cwd ?? process.cwd(),
            }
          : {
              scope: scope as 'global' | 'project',
              cwd: opts.cwd ?? process.cwd(),
              includeRuntime: true,
              validateRuntime: opts.coreValidate !== false,
            },
      );
      const failed = checks.filter((c) => c.status === 'fail');
      const skipped = checks.filter((c) => c.status === 'skip');
      const counts = {
        pass: checks.length - failed.length - skipped.length,
        skip: skipped.length,
        fail: failed.length,
      };
      if (opts.json || isMachineMode()) {
        output({ checks, summary: counts });
      } else {
        for (const c of checks) row(c.name, c.status, c.detail ? `${c.detail}${c.path ? ` (${c.path})` : ''}` : c.path);
        summary(counts);
      }
      if (failed.length > 0) bailWith(EXIT.GENERIC);
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
          '../../governance/rules-projection.js'
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
