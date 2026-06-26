import { Command } from 'commander';
import { EXIT, bailWith } from '../exit-codes.js';
import { error, output, row, success, summary } from '../output.js';
import { isMachineMode } from '../non-interactive.js';
import type { ConfigureCodexRuntimeOptions } from '../../runtime/codex/index.js';

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

function parsePositiveInt(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    error(`${label}: expected a positive integer`);
    bailWith(EXIT.USAGE);
  }
  return parsed;
}

function parseRuntimeOptions(opts: {
  cwd?: string;
  runtimeApiKey?: string;
  agentId?: string;
  coreUrl?: string;
  approvalMode?: string;
  governanceTimeout?: string;
  hitlMaxWait?: string;
  hitlPollInterval?: string;
}): ConfigureCodexRuntimeOptions | undefined {
  if (
    opts.runtimeApiKey === undefined &&
    opts.agentId === undefined &&
    opts.coreUrl === undefined &&
    opts.approvalMode === undefined &&
    opts.governanceTimeout === undefined &&
    opts.hitlMaxWait === undefined &&
    opts.hitlPollInterval === undefined
  ) {
    return undefined;
  }
  const approvalMode = opts.approvalMode;
  if (
    approvalMode !== undefined &&
    approvalMode !== 'inline' &&
    approvalMode !== 'remote' &&
    approvalMode !== 'defer'
  ) {
    error(`--approval-mode: invalid value '${approvalMode}'; expected inline, remote, or defer`);
    bailWith(EXIT.USAGE);
  }
  return {
    cwd: opts.cwd,
    apiKey: opts.runtimeApiKey,
    agentId: opts.agentId,
    coreUrl: opts.coreUrl,
    approvalMode: approvalMode as ConfigureCodexRuntimeOptions['approvalMode'],
    governanceTimeout: parsePositiveInt(opts.governanceTimeout, '--governance-timeout'),
    hitlMaxWait: parsePositiveInt(opts.hitlMaxWait, '--hitl-max-wait'),
    hitlPollInterval: parsePositiveInt(opts.hitlPollInterval, '--hitl-poll-interval'),
  };
}

async function configureRuntimeIfRequested(opts: {
  cwd?: string;
  runtimeApiKey?: string;
  agentId?: string;
  coreUrl?: string;
  approvalMode?: string;
  governanceTimeout?: string;
  hitlMaxWait?: string;
  hitlPollInterval?: string;
}): Promise<void> {
  const runtime = parseRuntimeOptions(opts);
  if (!runtime) return;
  const { configureCodexRuntime } = await import('../../runtime/codex/index.js');
  configureCodexRuntime(runtime);
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
    .option('--runtime-api-key <key>', 'Agent runtime key written to project .codex-hooks/config.json')
    .option('--agent-id <id>', 'Resolve the runtime key from the project OpenBox agent-key cache')
    .option('--core-url <url>', 'Core/runtime policy endpoint written to project .codex-hooks/config.json')
    .option('--approval-mode <mode>', 'Approval mode: remote, inline, or defer')
    .option('--governance-timeout <seconds>', 'Governance request timeout in seconds')
    .option('--hitl-max-wait <seconds>', 'Maximum human-approval wait in seconds')
    .option('--hitl-poll-interval <seconds>', 'Human-approval polling interval in seconds')
    .action(async (opts: {
      cwd?: string;
      runtimeApiKey?: string;
      agentId?: string;
      coreUrl?: string;
      approvalMode?: string;
      governanceTimeout?: string;
      hitlMaxWait?: string;
      hitlPollInterval?: string;
    }) => {
      const { installCodex } = await import('../../runtime/codex/index.js');
      installCodex({ cwd: opts.cwd });
      await configureRuntimeIfRequested(opts);
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
    .option('--runtime-api-key <key>', 'Agent runtime key written to project .codex-hooks/config.json')
    .option('--agent-id <id>', 'Resolve the runtime key from the project OpenBox agent-key cache')
    .option('--core-url <url>', 'Core/runtime policy endpoint written to project .codex-hooks/config.json')
    .option('--approval-mode <mode>', 'Approval mode: remote, inline, or defer')
    .option('--governance-timeout <seconds>', 'Governance request timeout in seconds')
    .option('--hitl-max-wait <seconds>', 'Maximum human-approval wait in seconds')
    .option('--hitl-poll-interval <seconds>', 'Human-approval polling interval in seconds')
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
      runtimeApiKey?: string;
      agentId?: string;
      coreUrl?: string;
      approvalMode?: string;
      governanceTimeout?: string;
      hitlMaxWait?: string;
      hitlPollInterval?: string;
      matcher: string[];
    }) => {
      const { installCodexPlugin } = await import('../../runtime/codex/index.js');
      const runtime = parseRuntimeOptions(opts);
      const target = installCodexPlugin({
        cwd: opts.cwd,
        target: opts.target,
        symlink: opts.symlink,
        matchers: parseMatcherPairs(opts.matcher),
        skipRepoSkill: opts.skipRepoSkill,
        skipMarketplace: opts.skipMarketplace,
        runtime,
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
