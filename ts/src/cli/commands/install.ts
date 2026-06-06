// `openbox install <target>` and `openbox uninstall <target>`.
// Targets: approver, extension, cursor, claude-code, mcp, skill, mobile.

import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EXIT, bailWith } from '../exit-codes.js';
import {
  error,
  info,
  action,
  success,
  row,
  summary,
  output,
} from '../output.js';
import { isMachineMode } from '../non-interactive.js';
import {
  APPLICATIONS_DIR,
  APPROVER_BUNDLE_NAME,
  installApprover,
  uninstallApprover,
} from './install-approver.js';

export {
  findBuiltApproverApp,
  installApprover,
  uninstallApprover,
  type ApproverBundleLocation,
  type ApproverBundleSource,
} from './install-approver.js';
import { installExtension, uninstallExtension } from './install-extension.js';
import {
  INSTALL_ALL_TARGETS,
  planInstallAll,
  planUninstallAll,
  runPlan,
  type PlanEntry,
} from './install-plan.js';

export {
  findVsix,
  installExtension,
  pickHosts,
  uninstallExtension,
  whichSync,
} from './install-extension.js';
export {
  INSTALL_ALL_TARGETS,
  planInstallAll,
  planUninstallAll,
  runPlan,
  type AllOpts,
  type InstallAllEnv,
  type InstallAllTarget,
  type PlanEntry,
  type RunSummary,
} from './install-plan.js';

// ---------------------------------------------------------------------------
// Mobile (iOS approver app status)
// ---------------------------------------------------------------------------

const MOBILE_APP_STORE_URL = 'https://apps.apple.com/app/openbox';

export function installMobile(): void {
  info(`iOS app: ${MOBILE_APP_STORE_URL}`);
  info(
    '(Beta. App Store listing pending; the iOS app authenticates via its own login flow: no CLI install step.)',
  );
}

type HostScope = 'global' | 'project' | 'local';

/**
 * Validates and normalizes the `--scope` flag. `local` is only
 * meaningful for Claude Code; cursor rejects it.
 */
export function parseHostScope(
  raw: string | undefined,
  host: 'cursor' | 'claude-code',
): HostScope {
  const value = (raw ?? 'global').toLowerCase() as HostScope;
  if (value !== 'global' && value !== 'project' && value !== 'local') {
    error(
      `--scope: invalid value '${raw}'; expected global, project, or local`,
    );
    bailWith(EXIT.USAGE);
  }
  if (value === 'local' && host !== 'claude-code') {
    error(`--scope local is only supported for claude-code`);
    bailWith(EXIT.USAGE);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Wire the install / uninstall trees
// ---------------------------------------------------------------------------

interface InstallOpts {
  // approver
  dest?: string;
  cleanBuild?: boolean;
  // extension
  code?: boolean;
  cursor?: boolean;
  // mcp
  claudeDesktop?: boolean;
  claudeCode?: boolean;
  // unified cursor install
  hooksOnly?: boolean;
  extension?: boolean;
  mcp?: boolean;
}

type McpTarget = 'claude-desktop' | 'cursor' | 'claude-code';

export function pickMcpTargets(opts: InstallOpts): McpTarget[] | undefined {
  const targets: McpTarget[] = [];
  if (opts.claudeDesktop) targets.push('claude-desktop');
  if (opts.cursor) targets.push('cursor');
  if (opts.claudeCode) targets.push('claude-code');
  return targets.length > 0 ? targets : undefined;
}

interface AllCliOpts {
  skip?: string[];
  only?: string[];
  dryRun?: boolean;
}

async function runInstallAll(opts: AllCliOpts): Promise<void> {
  // Bare `openbox install` does NOT auto-detect or suggest anything.
  // Scripts and humans alike must name targets explicitly: either
  // `--only <target>` (repeatable) or a per-target subcommand like
  // `openbox install extension`.
  const explicitlyScoped = opts.only && opts.only.length > 0;
  if (!explicitlyScoped) {
    error('no targets specified', {
      help:
        'pass --only <target> or use a per-target subcommand\n' +
        `valid:   ${INSTALL_ALL_TARGETS.join(', ')}\n` +
        'example: openbox install extension',
    });
    bailWith(EXIT.USAGE);
    return;
  }

  let plan: PlanEntry[];
  try {
    plan = planInstallAll(opts);
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    bailWith(EXIT.USAGE);
    return;
  }

  const result = await runPlan(plan, { dryRun: opts.dryRun, verb: 'install' });
  if (result.failed.length > 0) bailWith(EXIT.GENERIC);
}

async function runUninstallAll(opts: AllCliOpts): Promise<void> {
  let plan: PlanEntry[];
  try {
    plan = planUninstallAll(opts);
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    bailWith(EXIT.USAGE);
    return;
  }
  const result = await runPlan(plan, {
    dryRun: opts.dryRun,
    verb: 'uninstall',
  });
  if (result.failed.length > 0) bailWith(EXIT.GENERIC);
}

function collect(value: string, prev: string[]): string[] {
  return prev.concat([value]);
}

export function registerInstallCommands(program: Command): void {
  const install = program
    .command('install')
    .description(
      'Install OpenBox client surfaces. Targets are opt-in: pass ' +
        `--only <target> (repeatable) or run \`openbox install <target>\`. ` +
        `Targets: ${INSTALL_ALL_TARGETS.join(', ')}.`,
    )
    .option(
      '--only <target>',
      'Install named targets (repeatable).',
      collect,
      [],
    )
    .option('--dry-run', 'Print what would be installed without running', false)
    .action(async (opts: AllCliOpts) => {
      await runInstallAll(opts);
    });

  install
    .command('approver')
    .description(`Install ${APPROVER_BUNDLE_NAME} into /Applications`)
    .option('--dest <path>', 'Install location', APPLICATIONS_DIR)
    .option(
      '--clean-build',
      'After copying, remove the source bundle from the workspace build dir so Spotlight does not index two copies',
      false,
    )
    .action((opts: InstallOpts) =>
      installApprover({
        dest: opts.dest ?? APPLICATIONS_DIR,
        cleanBuild: opts.cleanBuild,
      }),
    );

  install
    .command('extension')
    .description('Install the OpenBox VS Code / Cursor extension')
    .option('--code', 'VS Code only', false)
    .option('--cursor', 'Cursor only', false)
    .action((opts: InstallOpts) => installExtension(opts));

  install
    .command('cursor')
    .description(
      'Install the full Cursor surface: hooks (~/.cursor/hooks.json), the ' +
        'IDE extension, the MCP server entry, slash commands, rules, plugin ' +
        'agents, the OpenBox skill, and (with consent) the enterprise ' +
        'hardening profile (~/.cursor/User/settings.json). Use --no-harden ' +
        'to skip the hardening prompt.',
    )
    .option('--no-harden', 'Skip the enterprise hardening profile (no prompt)')
    .option('--no-mcp', 'Skip the MCP server entry')
    .option(
      '--scope <scope>',
      'Install scope: `global` writes to ~/.cursor; `project` writes ' +
        'to <cwd>/.cursor so the hook block only applies inside the ' +
        'project. Defaults to `global`.',
      'global',
    )
    .option(
      '--cwd <dir>',
      'Project root for `--scope project`. Defaults to the current ' +
        'working directory.',
    )
    .option(
      '--matcher <pair>',
      'Cursor hook matcher pair `<event>=<regex>`. Repeatable. Cursor ' +
        'skips the hook when the matcher does not match the event input ' +
        '(shell command, file path, tool name, etc.), cutting process ' +
        'spawns dramatically. Example: ' +
        "--matcher 'beforeShellExecution=\\\\b(rm|sudo|curl|wget)\\\\b'",
      collect,
      [],
    )
    .action(
      async (opts: {
        harden?: boolean;
        mcp?: boolean;
        scope?: string;
        cwd?: string;
        matcher: string[];
      }) => {
        const scope = parseHostScope(opts.scope, 'cursor');
        const cwd = opts.cwd ?? process.cwd();
        const matchers: Record<string, string> = {};
        for (const pair of opts.matcher ?? []) {
          const idx = pair.indexOf('=');
          if (idx <= 0) {
            error(
              `--matcher: invalid pair '${pair}', expected <event>=<regex>`,
            );
            bailWith(EXIT.USAGE);
          }
          matchers[pair.slice(0, idx).trim()] = pair.slice(idx + 1);
        }
        const { installCursor } =
          await import('../../runtime/cursor/install.js');
        installCursor({
          scope,
          cwd,
          matchers: Object.keys(matchers).length > 0 ? matchers : undefined,
        });
        if (opts.mcp !== false) {
          info('');
          const { installMcp } = await import('../../runtime/mcp/install.js');
          installMcp({
            targets: ['cursor'],
            scope: scope === 'local' ? 'project' : scope,
            cwd,
          });
        }
        // Per-extension, slash commands, rules, plugin agents, the
        // OpenBox skill, and the hardening profile are user-level
        // installs that do not change with `--scope project`. Skip
        // them unless installing globally.
        if (scope !== 'global') {
          info('');
          const { verifyCursorInstall } =
            await import('../../runtime/cursor/install.js');
          const checks = verifyCursorInstall({ scope, cwd });
          const failed = checks.filter((c) => c.status === 'fail');
          for (const c of checks) row(c.name, c.status, c.detail);
          if (failed.length > 0) {
            error('Cursor install verification failed', {
              help: 'run `openbox cursor doctor --scope project --json` for details',
            });
            bailWith(EXIT.GENERIC);
          }
          return;
        }
        info('');
        installExtension({ cursor: true });
        info('');
        const {
          installCursorCommands,
          installCursorRules,
          installCursorAgents,
        } = await import('../../runtime/cursor/commands.js');
        installCursorCommands();
        info('');
        installCursorRules();
        info('');
        installCursorAgents();
        info('');
        const { installSkill } = await import('./skill.js');
        installSkill({ cursor: true });
        if (opts.harden !== false) {
          info('');
          const { consent } = await import('../non-interactive.js');
          const ok = await consent(
            'Apply OpenBox enterprise hardening profile to ~/.cursor/User/settings.json (privacy mode on, cloud features off, telemetry off)?',
          );
          if (ok) {
            const { hardenCursor } =
              await import('../../runtime/cursor/enterprise.js');
            const r = hardenCursor({ profile: 'enterprise-default' });
            success(`hardening profile applied: ${r.profile} → ${r.file}`);
          } else {
            info(
              'Skipped hardening profile (run `openbox cursor harden` later to apply).',
            );
          }
        }
        info('');
        const { verifyCursorInstall } =
          await import('../../runtime/cursor/install.js');
        const checks = verifyCursorInstall({ scope, cwd });
        const failed = checks.filter((c) => c.status === 'fail');
        for (const c of checks) {
          row(c.name, c.status, c.detail);
        }
        if (failed.length > 0) {
          error('Cursor install verification failed', {
            help: 'run `openbox cursor doctor --json` for details',
          });
          bailWith(EXIT.GENERIC);
        }
      },
    );

  install
    .command('claude-code')
    .description(
      'Install the full Claude Code surface: hooks, the MCP server ' +
        'entry, and the OpenBox skill. Use --scope project to scope ' +
        'the hooks and MCP entry to a single project rather than the ' +
        'user account.',
    )
    .option('--no-mcp', 'Skip the MCP server entry')
    .option(
      '--scope <scope>',
      'Install scope: `global` writes to ~/.claude; `project` writes ' +
        'to <cwd>/.claude so the hook block applies only inside the ' +
        'project; `local` writes to <cwd>/.claude/settings.local.json ' +
        '(personal override, typically gitignored). Defaults to ' +
        '`global`.',
      'global',
    )
    .option(
      '--cwd <dir>',
      'Project root for `--scope project` or `--scope local`. ' +
        'Defaults to the current working directory.',
    )
    .action(async (opts: { mcp?: boolean; scope?: string; cwd?: string }) => {
      const scope = parseHostScope(opts.scope, 'claude-code');
      const cwd = opts.cwd ?? process.cwd();
      const { installClaudeCode } =
        await import('../../runtime/claude-code/install.js');
      installClaudeCode({ scope, cwd });
      if (opts.mcp !== false) {
        info('');
        const { installMcp } = await import('../../runtime/mcp/install.js');
        installMcp({
          targets: ['claude-code'],
          scope: scope === 'local' ? 'project' : scope,
          cwd,
        });
      }
      // The skill copy is a user-level install; skip when scoping
      // hooks to a project to avoid scribbling into the user dir
      // from a project flow.
      if (scope === 'global') {
        info('');
        const { installSkill } = await import('./skill.js');
        installSkill();
      }
    });

  install
    .command('mcp')
    .description(
      'Register OpenBox as an MCP server in Claude Desktop, Cursor, ' +
        'and Claude Code. Writes a config entry that launches the ' +
        'openbox CLI so the host can start the server with no global ' +
        'install or npm package.',
    )
    .option('--claude-desktop', 'Claude Desktop only', false)
    .option('--cursor', 'Cursor only', false)
    .option('--claude-code', 'Claude Code only', false)
    .option(
      '--scope <scope>',
      "`global` writes to each host's user-level MCP config; " +
        '`project` writes to <cwd>/.cursor/mcp.json (Cursor) or ' +
        '<cwd>/.mcp.json (Claude Code). Claude Desktop only supports ' +
        '`global`. Defaults to `global`.',
      'global',
    )
    .option(
      '--cwd <dir>',
      'Project root for `--scope project`. Defaults to the current ' +
        'working directory.',
    )
    .action(async (opts: InstallOpts & { scope?: string; cwd?: string }) => {
      const scope = (opts.scope ?? 'global').toLowerCase();
      if (scope !== 'global' && scope !== 'project') {
        error(
          `--scope: invalid value '${opts.scope}'; expected global or project`,
        );
        bailWith(EXIT.USAGE);
      }
      const cwd = opts.cwd ?? process.cwd();
      const { installMcp } = await import('../../runtime/mcp/install.js');
      installMcp({
        targets: pickMcpTargets(opts),
        scope: scope as 'global' | 'project',
        cwd,
      });
    });

  install
    .command('skill')
    .description(
      'Install the OpenBox skill (SKILL.md + references) into both ' +
        '~/.claude/skills/openbox and ~/.cursor/skills/openbox so each ' +
        'editor surfaces the same content.',
    )
    .action(async () => {
      const { installSkill } = await import('./skill.js');
      installSkill();
      installSkill({ cursor: true });
    });

  install
    .command('mobile')
    .description(
      'Show iOS approver availability status',
    )
    .action(() => installMobile());

  const uninstall = program
    .command('uninstall')
    .description(
      'Remove OpenBox client surfaces. With no target, removes every ' +
        'detectable surface on this machine. Skill is opt-in (matches ' +
        '`install`): pass `--only skill` to remove it.',
    )
    .option(
      '--skip <target>',
      'Skip a target by name (repeatable)',
      collect,
      [],
    )
    .option(
      '--only <target>',
      'Only uninstall named targets (repeatable). Mutually exclusive with --skip.',
      collect,
      [],
    )
    .option(
      '--dry-run',
      'Print what would be uninstalled without running',
      false,
    )
    .action(async (opts: AllCliOpts) => {
      await runUninstallAll(opts);
    });

  uninstall
    .command('all')
    .description(
      'Remove every OpenBox piece detectable on this machine (same as ' +
        '`openbox uninstall` with no target).',
    )
    .option(
      '--skip <target>',
      'Skip a target by name (repeatable)',
      collect,
      [],
    )
    .option(
      '--only <target>',
      'Only uninstall named targets (repeatable). Mutually exclusive with --skip.',
      collect,
      [],
    )
    .option(
      '--dry-run',
      'Print what would be uninstalled without running',
      false,
    )
    .action(async (opts: AllCliOpts) => {
      await runUninstallAll(opts);
    });

  uninstall
    .command('approver')
    .description(`Remove ${APPROVER_BUNDLE_NAME} from /Applications`)
    .option('--dest <path>', 'Install location', APPLICATIONS_DIR)
    .action((opts: InstallOpts) =>
      uninstallApprover(opts.dest ?? APPLICATIONS_DIR),
    );

  uninstall
    .command('extension')
    .description('Remove the OpenBox VS Code / Cursor extension')
    .option('--code', 'VS Code only', false)
    .option('--cursor', 'Cursor only', false)
    .action((opts: InstallOpts) => uninstallExtension(opts));

  uninstall
    .command('cursor')
    .description(
      'Remove the Cursor surface: hooks, IDE extension, MCP server ' +
        'entry, and any OpenBox-managed keys in ' +
        '~/.cursor/User/settings.json. Use --scope project to remove ' +
        'a project-scoped install only.',
    )
    .option('--no-mcp', 'Skip removing the MCP server entry')
    .option(
      '--scope <scope>',
      'Uninstall scope: `global` removes from ~/.cursor; `project` ' +
        'removes from <cwd>/.cursor only. Defaults to `global`.',
      'global',
    )
    .option(
      '--cwd <dir>',
      'Project root for `--scope project`. Defaults to the current ' +
        'working directory.',
    )
    .action(async (opts: { mcp?: boolean; scope?: string; cwd?: string }) => {
      const scope = parseHostScope(opts.scope, 'cursor');
      const cwd = opts.cwd ?? process.cwd();
      const { uninstallCursor } =
        await import('../../runtime/cursor/install.js');
      uninstallCursor({ scope, cwd });
      if (opts.mcp !== false) {
        info('');
        const { uninstallMcp } = await import('../../runtime/mcp/install.js');
        uninstallMcp({
          targets: ['cursor'],
          scope: scope === 'local' ? 'project' : scope,
          cwd,
        });
      }
      if (scope !== 'global') return;
      info('');
      uninstallExtension({ cursor: true });
      info('');
      const {
        uninstallCursorCommands,
        uninstallCursorRules,
        uninstallCursorAgents,
      } = await import('../../runtime/cursor/commands.js');
      uninstallCursorCommands();
      uninstallCursorRules();
      uninstallCursorAgents();
      info('');
      const cursorSkillDst = path.join(
        os.homedir(),
        '.cursor',
        'skills',
        'openbox',
      );
      if (fs.existsSync(cursorSkillDst)) {
        execFileSync('rm', ['-rf', cursorSkillDst], { stdio: 'inherit' });
        success(`removed ${cursorSkillDst}`);
      }
      info('');
      const { unhardenCursor } =
        await import('../../runtime/cursor/enterprise.js');
      const r = unhardenCursor();
      if (r.removed.length > 0) {
        success(
          `removed ${r.removed.length} hardening profile keys from ${r.file}`,
        );
      }
    });

  uninstall
    .command('claude-code')
    .description(
      'Remove the Claude Code surface: hooks, MCP server entry, and ' +
        'the OpenBox skill. Use --scope project or --scope local to ' +
        'remove a project-scoped install only.',
    )
    .option('--no-mcp', 'Skip removing the MCP server entry')
    .option(
      '--scope <scope>',
      'Uninstall scope: `global` removes from ~/.claude; `project` ' +
        'removes from <cwd>/.claude; `local` removes only the ' +
        '<cwd>/.claude/settings.local.json hook block. Defaults to ' +
        '`global`.',
      'global',
    )
    .option(
      '--cwd <dir>',
      'Project root for `--scope project` or `--scope local`. ' +
        'Defaults to the current working directory.',
    )
    .action(async (opts: { mcp?: boolean; scope?: string; cwd?: string }) => {
      const scope = parseHostScope(opts.scope, 'claude-code');
      const cwd = opts.cwd ?? process.cwd();
      const { uninstallClaudeCode } =
        await import('../../runtime/claude-code/install.js');
      uninstallClaudeCode({ scope, cwd });
      if (opts.mcp !== false) {
        info('');
        const { uninstallMcp } = await import('../../runtime/mcp/install.js');
        uninstallMcp({
          targets: ['claude-code'],
          scope: scope === 'local' ? 'project' : scope,
          cwd,
        });
      }
      if (scope !== 'global') return;
      info('');
      const skillDst = path.join(os.homedir(), '.claude', 'skills', 'openbox');
      if (fs.existsSync(skillDst)) {
        execFileSync('rm', ['-rf', skillDst], { stdio: 'inherit' });
        success(`removed ${skillDst}`);
      }
    });

  uninstall
    .command('mcp')
    .description(
      'Remove the OpenBox MCP server entry from Claude Desktop, ' +
        'Cursor, and Claude Code. Use --scope project to remove ' +
        'project-scoped entries.',
    )
    .option('--claude-desktop', 'Claude Desktop only', false)
    .option('--cursor', 'Cursor only', false)
    .option('--claude-code', 'Claude Code only', false)
    .option(
      '--scope <scope>',
      'Uninstall scope: `global` (default) or `project`. Claude ' +
        'Desktop only supports `global`.',
      'global',
    )
    .option(
      '--cwd <dir>',
      'Project root for `--scope project`. Defaults to the current ' +
        'working directory.',
    )
    .action(async (opts: InstallOpts & { scope?: string; cwd?: string }) => {
      const scope = (opts.scope ?? 'global').toLowerCase();
      if (scope !== 'global' && scope !== 'project') {
        error(
          `--scope: invalid value '${opts.scope}'; expected global or project`,
        );
        bailWith(EXIT.USAGE);
      }
      const cwd = opts.cwd ?? process.cwd();
      const { uninstallMcp } = await import('../../runtime/mcp/install.js');
      uninstallMcp({
        targets: pickMcpTargets(opts),
        scope: scope as 'global' | 'project',
        cwd,
      });
    });

  // Mobile has no uninstall: the iOS app is removed device-side.
}
