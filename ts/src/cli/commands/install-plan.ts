import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isMachineMode } from '../non-interactive.js';
import { action, info, output, row, success, summary } from '../output.js';
import {
  APPLICATIONS_DIR,
  installApprover,
  uninstallApprover,
} from './install-approver.js';
import {
  installExtension,
  uninstallExtension,
  whichSync,
} from './install-extension.js';

/** Canonical target names accepted by --only/--skip and printed in the
 *  summary. Order here is also the run order. */
export const INSTALL_ALL_TARGETS = [
  'skill',
  'extension',
  'cursor',
  'claude-code',
  'mcp',
  'approver',
] as const;
export type InstallAllTarget = (typeof INSTALL_ALL_TARGETS)[number];

/** Seams for unit tests: every fact about the host that gates a target
 *  goes through this object so tests can fake darwin/linux, present /
 *  absent settings dirs, and present / absent `code`/`cursor` on PATH
 *  without spawning real child processes. */
export interface InstallAllEnv {
  platform(): NodeJS.Platform;
  homedir(): string;
  exists(p: string): boolean;
  hasOnPath(bin: string): boolean;
}

function defaultInstallAllEnv(): InstallAllEnv {
  return {
    platform: () => os.platform(),
    homedir: () => os.homedir(),
    exists: (p) => fs.existsSync(p),
    hasOnPath: (bin) => whichSync(bin) !== null,
  };
}

export interface PlanEntry {
  target: InstallAllTarget;
  /** Either a runnable action or a skip reason. The summary distinguishes. */
  skipReason?: string;
  /** Human-readable detail printed alongside "Installing <target>..." */
  detail?: string;
  run?: () => void | Promise<void>;
}

export interface AllOpts {
  skip?: string[];
  only?: string[];
  dryRun?: boolean;
}

/** Build the run plan for bare `openbox install`. Pure: no side effects,
 *  just detection + filtering. Exported for tests. */
export function planInstallAll(
  opts: AllOpts,
  env: InstallAllEnv = defaultInstallAllEnv(),
): PlanEntry[] {
  if (opts.skip && opts.skip.length > 0 && opts.only && opts.only.length > 0) {
    throw new Error('--skip and --only are mutually exclusive.');
  }

  const onlySet = opts.only && opts.only.length > 0 ? new Set(opts.only) : null;
  const skipSet = new Set(opts.skip ?? []);

  if (onlySet) {
    for (const name of onlySet) {
      if (!INSTALL_ALL_TARGETS.includes(name as InstallAllTarget)) {
        throw new Error(
          `Unknown --only target "${name}". Known: ${INSTALL_ALL_TARGETS.join(', ')}.`,
        );
      }
    }
  }
  for (const name of skipSet) {
    if (!INSTALL_ALL_TARGETS.includes(name as InstallAllTarget)) {
      throw new Error(
        `Unknown --skip target "${name}". Known: ${INSTALL_ALL_TARGETS.join(', ')}.`,
      );
    }
  }

  const home = env.homedir();
  const cursorDir = path.join(home, '.cursor');
  const claudeDir = path.join(home, '.claude');
  const isMac = env.platform() === 'darwin';
  const hasCode = env.hasOnPath('code');
  const hasCursor = env.hasOnPath('cursor');
  const hasClaudeDir = env.exists(claudeDir);
  const hasCursorDir = env.exists(cursorDir);
  // MCP host config locations we'd write into. Keep in sync with
  // runtime/mcp/install.ts. Platform routes through `env` so tests
  // can pin macOS / linux / win32 without faking process.platform.
  const platform = env.platform();
  const claudeDesktopCfg =
    platform === 'darwin'
      ? path.join(
          home,
          'Library',
          'Application Support',
          'Claude',
          'claude_desktop_config.json',
        )
      : platform === 'win32'
        ? path.join(
            home,
            'AppData',
            'Roaming',
            'Claude',
            'claude_desktop_config.json',
          )
        : path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
  const hasClaudeDesktop = env.exists(path.dirname(claudeDesktopCfg));

  const plan: PlanEntry[] = [];

  // Targets that the bare `openbox install` flow auto-suggests must
  // earn it: each one gates on a host artifact actually being present
  // on this machine, and the entry is omitted (not "skipped") when no
  // host is found. The user can still install the surface directly
  // via `openbox install <target>` or `--only <target>`; that path
  // forces the target through (`onlySet` truthy) so creation-side
  // installers still run.

  for (const target of INSTALL_ALL_TARGETS) {
    if (onlySet && !onlySet.has(target)) continue;
    if (skipSet.has(target)) {
      plan.push({ target, skipReason: 'excluded by --skip' });
      continue;
    }

    switch (target) {
      case 'skill': {
        // Skill is opt-in only and never part of the bare-install
        // auto-detect plan. Reach it via `openbox install skill` or
        // `--only skill`. (The skill bundle is small and most users
        // don't want it copied into both ~/.claude and ~/.cursor by
        // default just because those dirs happen to exist.)
        if (!onlySet) continue;
        const hosts: string[] = [];
        if (hasClaudeDir) hosts.push('claude');
        if (hasCursorDir) hosts.push('cursor');
        plan.push({
          target,
          detail: hosts.length > 0 ? `hosts: ${hosts.join(', ')}` : undefined,
          run: async () => {
            const { installSkill } = await import('./skill.js');
            installSkill();
            installSkill({ cursor: true });
          },
        });
        break;
      }

      case 'extension': {
        if (!hasCode && !hasCursor) {
          plan.push({
            target,
            skipReason: 'neither `code` nor `cursor` on PATH',
          });
          break;
        }
        const detected: string[] = [];
        if (hasCode) detected.push('code');
        if (hasCursor) detected.push('cursor');
        plan.push({
          target,
          detail: `hosts: ${detected.join(', ')}`,
          run: () => installExtension({ code: hasCode, cursor: hasCursor }),
        });
        break;
      }

      case 'cursor': {
        if (!env.exists(cursorDir)) {
          plan.push({ target, skipReason: `${cursorDir} not present` });
          break;
        }
        plan.push({
          target,
          detail: cursorDir,
          run: async () => {
            const { installCursor } =
              await import('../../runtime/cursor/install.js');
            installCursor();
            // Slash commands ship alongside hooks: bundle is meaningless
            // without the in-chat surface that drives the CLI. Rules +
            // plugin agents come along too: same pattern, same dir.
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
            // Harden is part of the full Cursor stack (mirrors what
            // `install cursor` does standalone). Consent-gated:
            // --yes auto-yes, non-interactive without --yes silently
            // skip, interactive TTY prompt y/N.
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
          },
        });
        break;
      }

      case 'claude-code': {
        // Don't auto-suggest creating ~/.claude on a machine that
        // never used Claude Code. Per-target subcommand and --only
        // still install (creating the dir as needed).
        if (!hasClaudeDir && !onlySet) continue;
        plan.push({
          target,
          detail: path.join(claudeDir, 'settings.json'),
          run: async () => {
            const { installClaudeCode } =
              await import('../../runtime/claude-code/install.js');
            installClaudeCode();
          },
        });
        break;
      }

      case 'mcp': {
        const hosts: string[] = [];
        if (hasClaudeDesktop) hosts.push('claude-desktop');
        if (hasCursorDir) hosts.push('cursor');
        if (hasClaudeDir) hosts.push('claude-code');
        if (hosts.length === 0 && !onlySet) continue;
        plan.push({
          target,
          detail: hosts.length > 0 ? `hosts: ${hosts.join(', ')}` : undefined,
          run: async () => {
            const { installMcp } = await import('../../runtime/mcp/install.js');
            installMcp({});
          },
        });
        break;
      }

      case 'approver': {
        if (!isMac) {
          plan.push({ target, skipReason: 'macOS only' });
          break;
        }
        plan.push({
          target,
          detail: APPLICATIONS_DIR,
          run: () =>
            installApprover({ dest: APPLICATIONS_DIR, cleanBuild: true }),
        });
        break;
      }
    }
  }

  return plan;
}

/** Build the uninstall plan. Mirror of `planInstallAll`: same detection
 *  rules, but each `run` calls the matching uninstall handler. */
export function planUninstallAll(
  opts: AllOpts,
  env: InstallAllEnv = defaultInstallAllEnv(),
): PlanEntry[] {
  // Reuse the install plan to get the skip/only validation + ordering,
  // then swap each `run` for its uninstall counterpart.
  const installPlan = planInstallAll(opts, env);
  return installPlan.map((entry) => {
    if (entry.skipReason) return entry;
    switch (entry.target) {
      case 'skill':
        return {
          ...entry,
          run: () => {
            // The skill installer copies into both ~/.claude and
            // ~/.cursor; uninstall mirrors that.
            const dsts = [
              path.join(env.homedir(), '.claude', 'skills', 'openbox'),
              path.join(env.homedir(), '.cursor', 'skills', 'openbox'),
            ];
            let removed = 0;
            for (const dst of dsts) {
              if (fs.existsSync(dst)) {
                execFileSync('rm', ['-rf', dst], { stdio: 'inherit' });
                success(`removed ${dst}`);
                removed++;
              }
            }
            if (removed === 0)
              info(`No skill copies installed under ${dsts.join(' / ')}.`);
          },
        };
      case 'extension': {
        const hasCode = env.hasOnPath('code');
        const hasCursor = env.hasOnPath('cursor');
        return {
          ...entry,
          run: () => uninstallExtension({ code: hasCode, cursor: hasCursor }),
        };
      }
      case 'cursor':
        return {
          ...entry,
          run: async () => {
            const { uninstallCursor } =
              await import('../../runtime/cursor/install.js');
            uninstallCursor();
            const {
              uninstallCursorCommands,
              uninstallCursorRules,
              uninstallCursorAgents,
            } = await import('../../runtime/cursor/commands.js');
            uninstallCursorCommands();
            uninstallCursorRules();
            uninstallCursorAgents();
          },
        };
      case 'claude-code':
        return {
          ...entry,
          run: async () => {
            const { uninstallClaudeCode } =
              await import('../../runtime/claude-code/install.js');
            uninstallClaudeCode();
          },
        };
      case 'mcp':
        return {
          ...entry,
          run: async () => {
            const { uninstallMcp } =
              await import('../../runtime/mcp/install.js');
            uninstallMcp({});
          },
        };
      case 'approver':
        return {
          ...entry,
          run: () => uninstallApprover(APPLICATIONS_DIR),
        };
    }
  });
}

export interface RunSummary {
  installed: InstallAllTarget[];
  skipped: Array<{ target: InstallAllTarget; reason: string }>;
  failed: Array<{ target: InstallAllTarget; error: string }>;
}

/** Drive the plan: log per-target status, never bail on a single
 *  failure, return a structured summary. Exported for tests. */
export async function runPlan(
  plan: PlanEntry[],
  opts: { dryRun?: boolean; verb?: 'install' | 'uninstall' } = {},
): Promise<RunSummary> {
  const verb = opts.verb ?? 'install';
  const result: RunSummary = { installed: [], skipped: [], failed: [] };

  for (const entry of plan) {
    if (entry.skipReason) {
      row(entry.target, 'skipped', entry.skipReason);
      result.skipped.push({ target: entry.target, reason: entry.skipReason });
      continue;
    }
    if (opts.dryRun) {
      row(
        entry.target,
        verb === 'install' ? 'would-install' : 'would-remove',
        entry.detail,
      );
      result.installed.push(entry.target);
      continue;
    }
    action(verb === 'install' ? 'Installing' : 'Uninstalling', entry.target);
    try {
      await entry.run?.();
      result.installed.push(entry.target);
      row(
        entry.target,
        verb === 'install' ? 'installed' : 'removed',
        entry.detail,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.failed.push({ target: entry.target, error: msg });
      row(entry.target, 'failed', msg);
    }
  }

  if (isMachineMode()) {
    // In machine mode, the per-step row()/action()/success() calls
    // were silenced. Emit ONE JSON envelope so stdout still has a
    // single document agents can parse. Shape mirrors RunSummary.
    output({
      [verb === 'install' ? 'installed' : 'removed']: result.installed,
      skipped: result.skipped,
      failed: result.failed,
    });
  } else {
    summary({
      [verb === 'install' ? 'installed' : 'removed']: result.installed.length,
      skipped: result.skipped.length,
      failed: result.failed.length,
    });
  }

  return result;
}
