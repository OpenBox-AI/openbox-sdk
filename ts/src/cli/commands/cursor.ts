import { Command } from 'commander';
import { EXIT, bailWith } from '../exit-codes.js';
import { error, row, success, summary, output } from '../output.js';
import { isMachineMode } from '../non-interactive.js';
import type { ConfigureCursorRuntimeOptions } from '../../runtime/cursor/index.js';
import {
  hasAgentIdentityOptions,
  parseAgentIdentityOptions,
  type AgentIdentityOptions,
} from '../agent-identity-options.js';

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
  agentDid?: string;
  agentPrivateKey?: string;
  coreUrl?: string;
  approvalMode?: string;
  governanceTimeout?: string;
  hitlMaxWait?: string;
  hitlPollInterval?: string;
} & AgentIdentityOptions): ConfigureCursorRuntimeOptions | undefined {
  if (
    opts.runtimeApiKey === undefined &&
    opts.agentId === undefined &&
    !hasAgentIdentityOptions(opts) &&
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
    approvalMode !== 'remote'
  ) {
    error(`--approval-mode: invalid value '${approvalMode}'; expected inline or remote`);
    bailWith(EXIT.USAGE);
  }
  return {
    cwd: opts.cwd,
    apiKey: opts.runtimeApiKey,
    agentId: opts.agentId,
    coreUrl: opts.coreUrl,
    agentIdentity: parseAgentIdentityOptions(opts),
    approvalMode: approvalMode as ConfigureCursorRuntimeOptions['approvalMode'],
    governanceTimeout: parsePositiveInt(opts.governanceTimeout, '--governance-timeout'),
    hitlMaxWait: parsePositiveInt(opts.hitlMaxWait, '--hitl-max-wait'),
    hitlPollInterval: parsePositiveInt(opts.hitlPollInterval, '--hitl-poll-interval'),
  };
}

/** `openbox cursor <subcommand>`:
 *
 *    hook         stdin to governance to stdout, invoked by Cursor
 *                 per hook event.
 *    plugin       export/install/remove the project-local OpenBox Cursor plugin.
 *    doctor       verify project-local Cursor readiness.
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

  const plugin = cursor
    .command('plugin')
    .description('Export or install the local OpenBox Cursor plugin');

  plugin
    .command('export')
    .description('Write a complete marketplace-ready Cursor plugin folder')
    .requiredOption('--out <dir>', 'Output directory')
    .option(
      '--matcher <pair>',
      "Hook matcher pair `<event>=<regex>` copied into hooks/hooks.json. Repeatable.",
      collectPair,
      [],
    )
    .action(async (opts: { out: string; matcher: string[] }) => {
      const { exportCursorPlugin, verifyCursorPlugin } = await import('../../runtime/cursor/index.js');
      const out = exportCursorPlugin({
        out: opts.out,
        matchers: parseMatcherPairs(opts.matcher),
      });
      const checks = verifyCursorPlugin({ target: out });
      const failed = checks.filter((check) => check.status === 'fail');
      if (failed.length > 0) {
        output({ out, checks });
        bailWith(EXIT.GENERIC);
      }
      success(`exported Cursor plugin to ${out}`);
    });

  plugin
    .command('install')
    .description('Install the project-local OpenBox Cursor plugin only')
    .option('--cwd <dir>', 'Project root for project-local install')
    .option('--target <dir>', 'Cursor project-local plugin target directory')
    .option('--symlink <dir>', 'Symlink an already-exported plugin folder into Cursor')
    .option('--runtime-api-key <key>', 'Agent runtime key written to project .openbox/cursor/.env')
    .option('--agent-id <id>', 'Resolve the runtime key from the project OpenBox agent-key cache')
    .option('--agent-did <did>', 'Agent DID written to project .openbox/cursor/.env')
    .option('--agent-private-key <key>', 'Agent DID private key written to project .openbox/cursor/.env')
    .option('--core-url <url>', 'Core/runtime policy endpoint written to project .openbox/cursor/.env')
    .option('--approval-mode <mode>', 'Approval mode: remote or inline')
    .option('--governance-timeout <seconds>', 'Core evaluation request timeout in seconds')
    .option('--hitl-max-wait <seconds>', 'Maximum human-approval wait in seconds')
    .option('--hitl-poll-interval <seconds>', 'Human-approval polling interval in seconds')
    .option(
      '--matcher <pair>',
      "Hook matcher pair `<event>=<regex>` copied into hooks/hooks.json. Repeatable.",
      collectPair,
      [],
    )
    .action(
      async (opts: {
        cwd?: string;
        target?: string;
        symlink?: string;
        runtimeApiKey?: string;
        agentId?: string;
        agentDid?: string;
        agentPrivateKey?: string;
        coreUrl?: string;
        approvalMode?: string;
        governanceTimeout?: string;
        hitlMaxWait?: string;
        hitlPollInterval?: string;
        matcher: string[];
      }) => {
        const { installCursorPlugin } = await import('../../runtime/cursor/index.js');
        const target = installCursorPlugin({
          cwd: opts.cwd,
          target: opts.target,
          symlink: opts.symlink,
          matchers: parseMatcherPairs(opts.matcher),
          runtime: parseRuntimeOptions(opts),
        });
        success(`installed Cursor plugin at ${target}`);
      },
    );

  plugin
    .command('uninstall')
    .description('Remove the project-local OpenBox Cursor plugin only')
    .option('--cwd <dir>', 'Project root for project-local install')
    .option('--target <dir>', 'Cursor project-local plugin target directory')
    .action(async (opts: { cwd?: string; target?: string }) => {
      const { uninstallCursorPlugin } = await import('../../runtime/cursor/index.js');
      uninstallCursorPlugin({ cwd: opts.cwd, target: opts.target });
      success('removed Cursor plugin');
    });

  const repo = cursor
    .command('repo')
    .description('Install or remove cloud-compatible project Cursor files');

  repo
    .command('install')
    .description('Install .cursor hooks, MCP, rules, and .agents skill files')
    .option('--cwd <dir>', 'Project root for project-local install')
    .option('--runtime-api-key <key>', 'Agent runtime key written to project .openbox/cursor/.env')
    .option('--agent-id <id>', 'Resolve the runtime key from the project OpenBox agent-key cache')
    .option('--agent-did <did>', 'Agent DID written to project .openbox/cursor/.env')
    .option('--agent-private-key <key>', 'Agent DID private key written to project .openbox/cursor/.env')
    .option('--core-url <url>', 'Core/runtime policy endpoint written to project .openbox/cursor/.env')
    .option('--approval-mode <mode>', 'Approval mode: remote or inline')
    .option('--governance-timeout <seconds>', 'Core evaluation request timeout in seconds')
    .option('--hitl-max-wait <seconds>', 'Maximum human-approval wait in seconds')
    .option('--hitl-poll-interval <seconds>', 'Human-approval polling interval in seconds')
    .option(
      '--matcher <pair>',
      "Hook matcher pair `<event>=<regex>` copied into .cursor/hooks.json. Repeatable.",
      collectPair,
      [],
    )
    .action(async (opts: {
      cwd?: string;
      runtimeApiKey?: string;
      agentId?: string;
      agentDid?: string;
      agentPrivateKey?: string;
      coreUrl?: string;
      approvalMode?: string;
      governanceTimeout?: string;
      hitlMaxWait?: string;
      hitlPollInterval?: string;
      matcher: string[];
    }) => {
      const { installCursorRepoMode } = await import('../../runtime/cursor/index.js');
      const target = installCursorRepoMode({
        cwd: opts.cwd,
        matchers: parseMatcherPairs(opts.matcher),
        runtime: parseRuntimeOptions(opts),
      });
      success(`installed Cursor repo mode at ${target}`);
    });

  repo
    .command('uninstall')
    .description('Remove .cursor hooks, MCP, rules, and optionally the repo skill')
    .option('--cwd <dir>', 'Project root for project-local install')
    .option('--remove-skill', 'Also remove .agents/skills/openbox')
    .action(async (opts: { cwd?: string; removeSkill?: boolean }) => {
      const { uninstallCursorRepoMode } = await import('../../runtime/cursor/index.js');
      uninstallCursorRepoMode({
        cwd: opts.cwd,
        removeSkill: opts.removeSkill,
      });
      success('removed Cursor repo mode');
    });

  cursor
    .command('doctor')
    .description(
      'Verify the installed Cursor surface and hook runtime readiness.',
    )
    .option('--cwd <dir>', 'Project root for project-local install')
    .option('--plugin-target <dir>', 'Cursor project-local plugin target directory')
    .option('--mode <mode>', 'plugin, repo, or both', 'plugin')
    .option('--surface-only', 'Check installed files only; skip runtime key/core validation', false)
    .option('--no-core-validate', 'Check runtime config and key format without calling core')
    .option('--json', 'Emit machine-readable JSON', false)
    .action(async (opts: { cwd?: string; pluginTarget?: string; mode?: 'plugin' | 'repo' | 'both'; surfaceOnly?: boolean; coreValidate?: boolean; json?: boolean }) => {
      const { verifyCursorInstall } = await import('../../runtime/cursor/install.js');
      const mode = opts.mode ?? 'plugin';
      if (!['plugin', 'repo', 'both'].includes(mode)) {
        error(`--mode: invalid value '${mode}'; expected plugin, repo, or both`);
        bailWith(EXIT.USAGE);
      }
      const base = {
        cwd: opts.cwd,
        pluginTarget: opts.pluginTarget,
        mode,
      };
      const checks = opts.surfaceOnly
        ? verifyCursorInstall(base)
        : await verifyCursorInstall({
            ...base,
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
        for (const c of checks) row(c.name, c.status, c.detail ? `${c.detail}${c.path ? ` (${c.path})` : ''}` : c.path);
        summary(counts);
      }
      if (failed.length > 0) bailWith(EXIT.GENERIC);
    });
}
