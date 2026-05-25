// `openbox install <target>` and `openbox uninstall <target>`.
// Targets: approver, extension, cursor, claude-code, mcp, skill, mobile.

import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT, bailWith } from '../exit-codes.js';
import { error, warn, info, action, success, row, summary, kv, output } from '../output.js';
import { isMachineMode } from '../non-interactive.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Approver (macOS Tauri app)
// ---------------------------------------------------------------------------

const APPROVER_BUNDLE_NAME = 'OpenBox Approver.app';
const APPLICATIONS_DIR = '/Applications';

// Cap walk-up so a missing workspace marker doesn't iterate to filesystem root
// (or worse, hang on a network mount). 8 levels covers nested worktrees plus
// reasonable subdirectory depth.
const WORKSPACE_WALK_LIMIT = 8;

// Bundle paths inside the workspace, in priority order. Cargo workspace builds
// land in `target/`; per-crate builds may land under `apps/approver/...`. We
// check all three so users don't need an env override regardless of layout.
const WORKSPACE_BUNDLE_CANDIDATES = [
  ['target', 'release', 'bundle', 'macos', APPROVER_BUNDLE_NAME],
  ['apps', 'approver', 'src-tauri', 'target', 'release', 'bundle', 'macos', APPROVER_BUNDLE_NAME],
  ['apps', 'approver', 'target', 'release', 'bundle', 'macos', APPROVER_BUNDLE_NAME],
];

function ensureMac(target: string): void {
  if (os.platform() !== 'darwin') {
    error(`\`openbox install ${target}\` is macOS-only`, {
      help: 'on Linux / Windows, use `openbox install extension` instead',
    });
    bailWith(EXIT.GENERIC);
  }
}

export type ApproverBundleSource = 'env-path' | 'env-dir' | 'workspace';

export interface ApproverBundleLocation {
  path: string;
  source: ApproverBundleSource;
}

function isOpenboxSdkRoot(dir: string): boolean {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return false;
  try {
    const raw = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as { name?: unknown };
    return pkg.name === 'openbox-sdk';
  } catch {
    return false;
  }
}

function findWorkspaceRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (let i = 0; i < WORKSPACE_WALK_LIMIT; i++) {
    if (isOpenboxSdkRoot(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * Locate a built approver bundle. Resolution order:
 *   1. OPENBOX_APPROVER_APP_PATH (full path to the .app)
 *   2. OPENBOX_APPROVER_APP_DIR (parent dir holding the .app)
 *   3. Walk up from `cwd` to the openbox-sdk workspace root and probe known
 *      cargo output paths.
 *
 * Returns the resolved path plus the source so callers can decide whether the
 * source is user-managed (env vars) or build output (workspace).
 */
export function findBuiltApproverApp(cwd: string = process.cwd()): ApproverBundleLocation {
  const explicitPath = process.env.OPENBOX_APPROVER_APP_PATH;
  if (explicitPath && fs.existsSync(explicitPath)) {
    return { path: explicitPath, source: 'env-path' };
  }

  const dir = process.env.OPENBOX_APPROVER_APP_DIR;
  if (dir) {
    const candidate = path.join(dir, APPROVER_BUNDLE_NAME);
    if (fs.existsSync(candidate)) {
      return { path: candidate, source: 'env-dir' };
    }
  }

  const root = findWorkspaceRoot(cwd);
  if (root) {
    for (const segs of WORKSPACE_BUNDLE_CANDIDATES) {
      const candidate = path.join(root, ...segs);
      if (fs.existsSync(candidate)) {
        return { path: candidate, source: 'workspace' };
      }
    }
  }

  throw new Error(
    `Couldn't find "${APPROVER_BUNDLE_NAME}". Build it from the workspace root, or set OPENBOX_APPROVER_APP_PATH=/path/to/OpenBox\\ Approver.app or OPENBOX_APPROVER_APP_DIR=/dir/holding/the/.app.`,
  );
}

interface ApproverInstallOpts {
  dest?: string;
  cleanBuild?: boolean;
}

export function installApprover(opts: ApproverInstallOpts): void {
  ensureMac('approver');
  const dest = opts.dest ?? APPLICATIONS_DIR;
  const located = findBuiltApproverApp();
  const dst = path.join(dest, APPROVER_BUNDLE_NAME);
  kv({ source: located.path, destination: dst });
  if (fs.existsSync(dst)) {
    action('Removing existing bundle', dst);
    execFileSync('rm', ['-rf', dst], { stdio: 'inherit' });
  }
  execFileSync('cp', ['-R', located.path, dst], { stdio: 'inherit' });

  if (opts.cleanBuild) {
    if (located.source === 'workspace') {
      action('Removing source bundle', located.path);
      try {
        execFileSync('rm', ['-rf', located.path], { stdio: 'inherit' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warn(`failed to remove source bundle: ${msg}. continuing.`);
      }
    } else {
      info(
        '--clean-build skipped: bundle was located via OPENBOX_APPROVER_APP_PATH or ' +
          'OPENBOX_APPROVER_APP_DIR. Those paths are user-managed; not auto-deleting.',
      );
    }
  }

  success(`approver installed at ${dst}`);
  info("Launch from Spotlight (\"OpenBox Approver\"). Run `openbox auth set-api-key` first if you haven't.");
}

export function uninstallApprover(dest: string): void {
  ensureMac('approver');
  const dst = path.join(dest, APPROVER_BUNDLE_NAME);
  if (!fs.existsSync(dst)) {
    info(`${dst} is not installed.`);
    return;
  }
  action('Removing', dst);
  execFileSync('rm', ['-rf', dst], { stdio: 'inherit' });
  success(`approver removed from ${dst}`);
}

// ---------------------------------------------------------------------------
// Extension (VS Code / Cursor .vsix)
// ---------------------------------------------------------------------------

export function findVsix(): string {
  const candidates = [
    path.resolve(__dirname, '../../../../apps/extension'),
    path.resolve(__dirname, '../../apps/extension'),
    path.resolve(__dirname, '../../../apps/extension'),
  ];
  for (const c of candidates) {
    if (!fs.existsSync(c)) continue;
    const found = fs
      .readdirSync(c)
      .filter((f) => f.startsWith('openbox-') && f.endsWith('.vsix'))
      .map((f) => path.join(c, f))
      .sort()
      .pop();
    if (found) return found;
  }
  throw new Error(
    `Couldn't find an openbox-*.vsix. Build it first:\n` +
      `  cd apps/extension && npm run package`,
  );
}

function whichSync(bin: string): string | null {
  try {
    const result = execFileSync('which', [bin], { stdio: ['ignore', 'pipe', 'ignore'] });
    return result.toString('utf-8').trim() || null;
  } catch {
    return null;
  }
}

export function pickHosts(opts: { code?: boolean; cursor?: boolean }): string[] {
  if (opts.code || opts.cursor) {
    const out: string[] = [];
    if (opts.code) out.push('code');
    if (opts.cursor) out.push('cursor');
    return out;
  }
  return ['code', 'cursor'].filter((h) => whichSync(h));
}

export function installExtension(opts: { code?: boolean; cursor?: boolean }): void {
  // Test escape hatch: integration tests run the full install flow
  // against a throwaway HOME and don't want to touch the real
  // VS Code / Cursor extension store. Setting OPENBOX_SKIP_EXTENSION=1
  // makes the step a no-op so the rest of the install path
  // (hooks, MCP, skill, commands, rules, agents) is still exercised.
  if (process.env.OPENBOX_SKIP_EXTENSION === '1') {
    info('Skipping extension install (OPENBOX_SKIP_EXTENSION=1).');
    return;
  }
  const hosts = pickHosts(opts);
  if (hosts.length === 0) {
    error('neither `code` nor `cursor` is on PATH', {
      help: "install VS Code and run \"Shell Command: Install 'code' command in PATH\"",
    });
    bailWith(EXIT.GENERIC);
  }
  const vsix = findVsix();
  info(`Using extension package: ${vsix}`);
  for (const host of hosts) {
    action('Installing into', host);
    execFileSync(host, ['--install-extension', vsix, '--force'], { stdio: 'inherit' });
  }
  success('extension installed');
  info("Run `openbox auth set-api-key` if you haven't, so the extension can authenticate.");
}

export function uninstallExtension(opts: { code?: boolean; cursor?: boolean }): void {
  if (process.env.OPENBOX_SKIP_EXTENSION === '1') {
    info('Skipping extension uninstall (OPENBOX_SKIP_EXTENSION=1).');
    return;
  }
  const hosts = pickHosts(opts);
  if (hosts.length === 0) {
    error('neither `code` nor `cursor` is on PATH.');
    bailWith(EXIT.GENERIC);
  }
  const id = 'openbox.openbox';
  for (const host of hosts) {
    action('Uninstalling from', host);
    try {
      execFileSync(host, ['--uninstall-extension', id], { stdio: 'inherit' });
    } catch {
      /* not installed in this host; fine */
    }
  }
}

// ---------------------------------------------------------------------------
// Mobile (iOS approver app: App Store placeholder)
// ---------------------------------------------------------------------------

const MOBILE_APP_STORE_URL = 'https://apps.apple.com/app/openbox';

export function installMobile(): void {
  info(`iOS app: ${MOBILE_APP_STORE_URL}`);
  info('(Beta. App Store listing pending; the iOS app authenticates via its own login flow: no CLI install step.)');
}

type HostScope = 'global' | 'project' | 'local';

/**
 * Validates and normalizes the `--scope` flag. `local` is only
 * meaningful for Claude Code; cursor rejects it.
 */
export function parseHostScope(raw: string | undefined, host: 'cursor' | 'claude-code'): HostScope {
  const value = (raw ?? 'global').toLowerCase() as HostScope;
  if (value !== 'global' && value !== 'project' && value !== 'local') {
    error(`--scope: invalid value '${raw}'; expected global, project, or local`);
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

// ---------------------------------------------------------------------------
// `openbox install` (no target)
// Auto-detects the current platform's relevant install targets and prompts
// per-surface. Whitelist with --only <name> (repeatable). Skip with --skip
// <name> (repeatable, mutually exclusive with --only); both flags imply
// non-interactive. Preview with --dry-run.
// ---------------------------------------------------------------------------

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

interface PlanEntry {
  target: InstallAllTarget;
  /** Either a runnable action or a skip reason. The summary distinguishes. */
  skipReason?: string;
  /** Human-readable detail printed alongside "Installing <target>..." */
  detail?: string;
  run?: () => void | Promise<void>;
}

interface AllOpts {
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
      ? path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
      : platform === 'win32'
        ? path.join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json')
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
          plan.push({ target, skipReason: 'neither `code` nor `cursor` on PATH' });
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
            const { installCursor } = await import('../../runtime/cursor/install.js');
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
              const { hardenCursor } = await import('../../runtime/cursor/enterprise.js');
              const r = hardenCursor({ profile: 'enterprise-default' });
              success(`hardening profile applied: ${r.profile} → ${r.file}`);
            } else {
              info('Skipped hardening profile (run `openbox cursor harden` later to apply).');
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
            const { installClaudeCode } = await import('../../runtime/claude-code/install.js');
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
          run: () => installApprover({ dest: APPLICATIONS_DIR, cleanBuild: true }),
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
            if (removed === 0) info(`No skill copies installed under ${dsts.join(' / ')}.`);
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
            const { uninstallCursor } = await import('../../runtime/cursor/install.js');
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
            const { uninstallClaudeCode } = await import(
              '../../runtime/claude-code/install.js'
            );
            uninstallClaudeCode();
          },
        };
      case 'mcp':
        return {
          ...entry,
          run: async () => {
            const { uninstallMcp } = await import('../../runtime/mcp/install.js');
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

interface RunSummary {
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
      row(entry.target, verb === 'install' ? 'would-install' : 'would-remove', entry.detail);
      result.installed.push(entry.target);
      continue;
    }
    action(verb === 'install' ? 'Installing' : 'Uninstalling', entry.target);
    try {
      await entry.run?.();
      result.installed.push(entry.target);
      row(entry.target, verb === 'install' ? 'installed' : 'removed', entry.detail);
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
  const result = await runPlan(plan, { dryRun: opts.dryRun, verb: 'uninstall' });
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
      installApprover({ dest: opts.dest ?? APPLICATIONS_DIR, cleanBuild: opts.cleanBuild }),
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
      "Cursor hook matcher pair `<event>=<regex>`. Repeatable. Cursor " +
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
            error(`--matcher: invalid pair '${pair}', expected <event>=<regex>`);
            bailWith(EXIT.USAGE);
          }
          matchers[pair.slice(0, idx).trim()] = pair.slice(idx + 1);
        }
        const { installCursor } = await import('../../runtime/cursor/install.js');
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
          const { verifyCursorInstall } = await import('../../runtime/cursor/install.js');
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
            const { hardenCursor } = await import('../../runtime/cursor/enterprise.js');
            const r = hardenCursor({ profile: 'enterprise-default' });
            success(`hardening profile applied: ${r.profile} → ${r.file}`);
          } else {
            info('Skipped hardening profile (run `openbox cursor harden` later to apply).');
          }
        }
        info('');
        const { verifyCursorInstall } = await import('../../runtime/cursor/install.js');
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
    .action(
      async (opts: { mcp?: boolean; scope?: string; cwd?: string }) => {
        const scope = parseHostScope(opts.scope, 'claude-code');
        const cwd = opts.cwd ?? process.cwd();
        const { installClaudeCode } = await import('../../runtime/claude-code/install.js');
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
      },
    );

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
      '`global` writes to each host\'s user-level MCP config; ' +
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
        error(`--scope: invalid value '${opts.scope}'; expected global or project`);
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
    .description('Show the App Store link / QR for the iOS approver (placeholder)')
    .action(() => installMobile());

  const uninstall = program
    .command('uninstall')
    .description(
      'Remove OpenBox client surfaces. With no target, removes every ' +
        'detectable surface on this machine. Skill is opt-in (matches ' +
        '`install`): pass `--only skill` to remove it.',
    )
    .option('--skip <target>', 'Skip a target by name (repeatable)', collect, [])
    .option(
      '--only <target>',
      'Only uninstall named targets (repeatable). Mutually exclusive with --skip.',
      collect,
      [],
    )
    .option('--dry-run', 'Print what would be uninstalled without running', false)
    .action(async (opts: AllCliOpts) => {
      await runUninstallAll(opts);
    });

  uninstall
    .command('all')
    .description(
      'Remove every OpenBox piece detectable on this machine (same as ' +
        '`openbox uninstall` with no target).',
    )
    .option('--skip <target>', 'Skip a target by name (repeatable)', collect, [])
    .option(
      '--only <target>',
      'Only uninstall named targets (repeatable). Mutually exclusive with --skip.',
      collect,
      [],
    )
    .option('--dry-run', 'Print what would be uninstalled without running', false)
    .action(async (opts: AllCliOpts) => {
      await runUninstallAll(opts);
    });

  uninstall
    .command('approver')
    .description(`Remove ${APPROVER_BUNDLE_NAME} from /Applications`)
    .option('--dest <path>', 'Install location', APPLICATIONS_DIR)
    .action((opts: InstallOpts) => uninstallApprover(opts.dest ?? APPLICATIONS_DIR));

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
    .action(
      async (opts: { mcp?: boolean; scope?: string; cwd?: string }) => {
        const scope = parseHostScope(opts.scope, 'cursor');
        const cwd = opts.cwd ?? process.cwd();
        const { uninstallCursor } = await import('../../runtime/cursor/install.js');
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
        const cursorSkillDst = path.join(os.homedir(), '.cursor', 'skills', 'openbox');
        if (fs.existsSync(cursorSkillDst)) {
          execFileSync('rm', ['-rf', cursorSkillDst], { stdio: 'inherit' });
          success(`removed ${cursorSkillDst}`);
        }
        info('');
        const { unhardenCursor } = await import('../../runtime/cursor/enterprise.js');
        const r = unhardenCursor();
        if (r.removed.length > 0) {
          success(`removed ${r.removed.length} hardening profile keys from ${r.file}`);
        }
      },
    );

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
    .action(
      async (opts: { mcp?: boolean; scope?: string; cwd?: string }) => {
        const scope = parseHostScope(opts.scope, 'claude-code');
        const cwd = opts.cwd ?? process.cwd();
        const { uninstallClaudeCode } = await import('../../runtime/claude-code/install.js');
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
      },
    );

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
        error(`--scope: invalid value '${opts.scope}'; expected global or project`);
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
