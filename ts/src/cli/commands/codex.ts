import { Command } from 'commander';
import { EXIT, bailWith } from '../exit-codes.js';
import { error, output, row, success, summary } from '../output.js';
import { isMachineMode } from '../non-interactive.js';

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
