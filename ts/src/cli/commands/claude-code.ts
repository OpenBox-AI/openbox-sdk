import { Command } from 'commander';
import { EXIT, bailWith } from '../exit-codes.js';
import { isMachineMode } from '../non-interactive.js';
import { error, output, row, success, summary } from '../output.js';

function collectPair(value: string, prior: string[]): string[] {
  return [...prior, value];
}

function parseMatcherPairs(pairs: string[] | undefined): Record<string, string> | undefined {
  const matchers: Record<string, string> = {};
  for (const pair of pairs ?? []) {
    const idx = pair.indexOf('=');
    if (idx <= 0) {
      error(`--matcher: invalid pair '${pair}', expected <event>=<regex>`);
      bailWith(EXIT.USAGE);
    }
    matchers[pair.slice(0, idx).trim()] = pair.slice(idx + 1);
  }
  return Object.keys(matchers).length > 0 ? matchers : undefined;
}

function parsePluginScope(value: string | undefined): 'project' {
  const scope = (value ?? 'project').toLowerCase();
  if (scope !== 'project') {
    error(`--scope: invalid value '${value}'; expected project`);
    bailWith(EXIT.USAGE);
  }
  return 'project';
}

/** `openbox claude-code <subcommand>`:
 *
 *    hook        stdin to governance to stdout, invoked by Claude
 *                Code per hook event.
 *    plugin      export/install/remove the project-local Claude Code plugin.
 *    doctor      verify project-local Claude Code readiness.
 */
export function registerClaudeCodeCommands(program: Command) {
  const claude = program.command('claude-code').description('Claude Code integration');

  claude
    .command('hook')
    .description('Run the OpenBox hook handler (invoked by Claude Code per hook event)')
    .action(async () => {
      const { runClaudeHook } = await import('../../runtime/claude-code/hook-handler.js');
      try {
        await runClaudeHook();
      } catch (err) {
        // Fail-open: unhandled error means Claude Code uses default permissioning.
        error(`claude-code hook: ${(err as Error).message}`);
        bailWith(EXIT.OK);
      }
    });

  const plugin = claude
    .command('plugin')
    .description('Export or install the project-local OpenBox Claude Code plugin');

  plugin
    .command('export')
    .description('Write a complete marketplace-ready Claude Code plugin folder')
    .requiredOption('--out <dir>', 'Output directory')
    .option(
      '--matcher <pair>',
      "Hook matcher pair `<event>=<regex>` copied into hooks/hooks.json. Repeatable.",
      collectPair,
      [],
    )
    .option('--include-opt-in-hooks', 'Also install opt-in hook events such as SessionEnd and WorktreeCreate')
    .action(async (opts: { out: string; matcher: string[]; includeOptInHooks?: boolean }) => {
      const { exportClaudeCodePlugin, verifyClaudeCodePlugin } = await import(
        '../../runtime/claude-code/index.js'
      );
      const out = exportClaudeCodePlugin({
        out: opts.out,
        matchers: parseMatcherPairs(opts.matcher),
        includeOptInHooks: opts.includeOptInHooks,
      });
      const checks = verifyClaudeCodePlugin({
        target: out,
        includeOptInHooks: opts.includeOptInHooks,
      });
      const failed = checks.filter((check) => check.status === 'fail');
      if (failed.length > 0) {
        output({ out, checks });
        bailWith(EXIT.GENERIC);
      }
      success(`exported Claude Code plugin to ${out}`);
    });

  plugin
    .command('install')
    .description('Install the project-local OpenBox Claude Code plugin only')
    .option('--scope <scope>', 'project only', 'project')
    .option('--cwd <dir>', 'Project root for --scope project')
    .option('--target <dir>', 'Explicit Claude Code plugin target directory')
    .option('--symlink <dir>', 'Symlink an already-exported plugin folder into Claude Code')
    .option(
      '--matcher <pair>',
      "Hook matcher pair `<event>=<regex>` copied into hooks/hooks.json. Repeatable.",
      collectPair,
      [],
    )
    .option('--include-opt-in-hooks', 'Also install opt-in hook events such as SessionEnd and WorktreeCreate')
    .action(
      async (opts: {
        scope?: string;
        cwd?: string;
        target?: string;
        symlink?: string;
        matcher: string[];
        includeOptInHooks?: boolean;
      }) => {
        const { installClaudeCodePlugin } = await import('../../runtime/claude-code/index.js');
        const target = installClaudeCodePlugin({
          scope: parsePluginScope(opts.scope),
          cwd: opts.cwd,
          target: opts.target,
          symlink: opts.symlink,
          matchers: parseMatcherPairs(opts.matcher),
          includeOptInHooks: opts.includeOptInHooks,
        });
        success(`installed Claude Code plugin at ${target}`);
      },
    );

  plugin
    .command('uninstall')
    .description('Remove the project-local OpenBox Claude Code plugin only')
    .option('--scope <scope>', 'project only', 'project')
    .option('--cwd <dir>', 'Project root for --scope project')
    .option('--target <dir>', 'Explicit Claude Code plugin target directory')
    .action(async (opts: { scope?: string; cwd?: string; target?: string }) => {
      const { uninstallClaudeCodePlugin } = await import('../../runtime/claude-code/index.js');
      uninstallClaudeCodePlugin({
        scope: parsePluginScope(opts.scope),
        cwd: opts.cwd,
        target: opts.target,
      });
      success('removed Claude Code plugin');
    });

  claude
    .command('doctor')
    .description('Verify the installed Claude Code surface and hook runtime readiness')
    .option('--cwd <dir>', 'Project root for project-local install')
    .option('--plugin-target <dir>', 'Claude Code project-local plugin target directory')
    .option('--surface-only', 'Check installed files only; skip runtime key/core validation', false)
    .option('--no-core-validate', 'Check runtime config and key format without calling core')
    .option('--include-opt-in-hooks', 'Validate an installation that intentionally includes opt-in hooks')
    .option('--json', 'Emit machine-readable JSON', false)
    .action(async (opts: {
      cwd?: string;
      pluginTarget?: string;
      surfaceOnly?: boolean;
      coreValidate?: boolean;
      includeOptInHooks?: boolean;
      json?: boolean;
    }) => {
      const {
        claudeCodeGovernanceSummary,
        claudeCodeRuntimeDiagnostics,
        summarizeClaudeCodeChecks,
        verifyClaudeCodeInstall,
      } = await import('../../runtime/claude-code/index.js');
      const checks = await Promise.resolve(
        opts.surfaceOnly
          ? verifyClaudeCodeInstall({
              cwd: opts.cwd,
              pluginTarget: opts.pluginTarget,
              includeOptInHooks: opts.includeOptInHooks,
            })
          : verifyClaudeCodeInstall({
              cwd: opts.cwd,
              pluginTarget: opts.pluginTarget,
              includeOptInHooks: opts.includeOptInHooks,
              includeRuntime: true,
              validateRuntime: opts.coreValidate !== false,
            }),
      );
      const counts = summarizeClaudeCodeChecks(checks);
      const payload = {
        checks,
        summary: counts,
        runtimeReadiness: claudeCodeRuntimeDiagnostics(opts.cwd),
        claudeCodeGovernance: claudeCodeGovernanceSummary(),
      };
      if (opts.json || isMachineMode()) {
        output(payload);
      } else {
        for (const c of checks) {
          row(c.name, c.status, c.detail ? `${c.detail}${c.path ? ` (${c.path})` : ''}` : c.path);
        }
        summary(counts);
      }
      if (counts.fail > 0) bailWith(EXIT.GENERIC);
    });
}
