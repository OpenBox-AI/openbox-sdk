import { Command } from 'commander';
import { EXIT, bailWith } from '../exit-codes.js';
import { error, output, row, success, summary } from '../output.js';
import { isMachineMode } from '../non-interactive.js';

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

export function registerCodexCommands(program: Command) {
  const codex = program.command('codex').description('Codex integration');

  codex
    .command('hook')
    .description('Run the OpenBox hook handler (invoked by Codex per hook event)')
    .action(async () => {
      const { runCodexHook } = await import('../../runtime/codex/hook-handler.js');
      try {
        await runCodexHook();
      } catch (err) {
        error(`codex hook: ${(err as Error).message}`);
        bailWith(EXIT.OK);
      }
    });

  codex
    .command('install')
    .description('Install project-local Codex hooks')
    .option('--cwd <dir>', 'Project root for project-local install')
    .action(async (opts: { cwd?: string }) => {
      const { installCodex } = await import('../../runtime/codex/index.js');
      installCodex({ cwd: opts.cwd });
      success('Codex hooks installed');
    });

  codex
    .command('uninstall')
    .description('Remove project-local Codex hooks')
    .option('--cwd <dir>', 'Project root for project-local install')
    .action(async (opts: { cwd?: string }) => {
      const { uninstallCodex } = await import('../../runtime/codex/index.js');
      uninstallCodex({ cwd: opts.cwd });
      success('Codex hooks removed');
    });

  const plugin = codex
    .command('plugin')
    .description('Export or install the project-local OpenBox Codex plugin');

  plugin
    .command('export')
    .description('Write a complete Codex plugin folder')
    .requiredOption('--out <dir>', 'Output directory')
    .option(
      '--matcher <pair>',
      "Hook matcher pair `<event>=<regex>` copied into hooks/hooks.json. Repeatable.",
      collectPair,
      [],
    )
    .action(async (opts: { out: string; matcher: string[] }) => {
      const { exportCodexPlugin, verifyCodexPlugin } = await import('../../runtime/codex/index.js');
      const out = exportCodexPlugin({
        out: opts.out,
        matchers: parseMatcherPairs(opts.matcher),
      });
      const checks = verifyCodexPlugin({ target: out });
      const failed = checks.filter((check) => check.status === 'fail');
      if (failed.length > 0) {
        output({ out, checks });
        bailWith(EXIT.GENERIC);
      }
      success(`exported Codex plugin to ${out}`);
    });

  plugin
    .command('install')
    .description('Install the project-local OpenBox Codex plugin and repo skill')
    .option('--cwd <dir>', 'Project root for project-local install')
    .option('--target <dir>', 'Codex project-local plugin target directory')
    .option('--symlink <dir>', 'Symlink an already-exported plugin folder into the Codex marketplace')
    .option('--skip-repo-skill', 'Do not install .agents/skills/openbox')
    .option('--skip-marketplace', 'Do not write .agents/plugins/marketplace.json')
    .option(
      '--matcher <pair>',
      "Hook matcher pair `<event>=<regex>` copied into hooks/hooks.json. Repeatable.",
      collectPair,
      [],
    )
    .action(async (opts: {
      cwd?: string;
      target?: string;
      symlink?: string;
      skipRepoSkill?: boolean;
      skipMarketplace?: boolean;
      matcher: string[];
    }) => {
      const { installCodexPlugin } = await import('../../runtime/codex/index.js');
      const target = installCodexPlugin({
        cwd: opts.cwd,
        target: opts.target,
        symlink: opts.symlink,
        matchers: parseMatcherPairs(opts.matcher),
        skipRepoSkill: opts.skipRepoSkill,
        skipMarketplace: opts.skipMarketplace,
      });
      success(`installed Codex plugin at ${target}`);
    });

  plugin
    .command('uninstall')
    .description('Remove the project-local OpenBox Codex plugin')
    .option('--cwd <dir>', 'Project root for project-local install')
    .option('--target <dir>', 'Codex project-local plugin target directory')
    .option('--remove-repo-skill', 'Also remove .agents/skills/openbox')
    .option('--remove-marketplace-entry', 'Remove the openbox entry from .agents/plugins/marketplace.json')
    .action(async (opts: {
      cwd?: string;
      target?: string;
      removeRepoSkill?: boolean;
      removeMarketplaceEntry?: boolean;
    }) => {
      const { uninstallCodexPlugin } = await import('../../runtime/codex/index.js');
      uninstallCodexPlugin({
        cwd: opts.cwd,
        target: opts.target,
        removeRepoSkill: opts.removeRepoSkill,
        removeMarketplaceEntry: opts.removeMarketplaceEntry,
      });
      success('removed Codex plugin');
    });

  codex
    .command('doctor')
    .description('Verify project-local Codex hook and runtime readiness')
    .option('--cwd <dir>', 'Project root for project-local install')
    .option('--surface-only', 'Check installed files only; skip runtime key/core validation', false)
    .option('--no-core-validate', 'Check runtime config and key format without calling core')
    .option('--json', 'Emit machine-readable JSON', false)
    .action(async (opts: { cwd?: string; surfaceOnly?: boolean; coreValidate?: boolean; json?: boolean }) => {
      const { verifyCodexInstall } = await import('../../runtime/codex/install.js');
      const checks = opts.surfaceOnly
        ? verifyCodexInstall({ cwd: opts.cwd })
        : await verifyCodexInstall({
            cwd: opts.cwd,
            includeRuntime: true,
            validateRuntime: opts.coreValidate !== false,
          });
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
        for (const c of checks) {
          row(c.name, c.status, c.detail ? `${c.detail}${c.path ? ` (${c.path})` : ''}` : c.path);
        }
        summary(counts);
      }
      if (failed.length > 0) bailWith(EXIT.GENERIC);
    });
}
