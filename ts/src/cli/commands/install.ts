// `openbox install <target>` and `openbox uninstall <target>`.
// Targets: approver, extension, cursor, claude-code, mcp, skill, mobile.

import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT, bailWith } from '../exit-codes.js';

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
    console.error(
      `\`openbox install ${target}\` is macOS-only. ` +
        'On Linux/Windows, use `openbox install extension` instead.',
    );
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

function installApprover(opts: ApproverInstallOpts): void {
  ensureMac('approver');
  const dest = opts.dest ?? APPLICATIONS_DIR;
  const located = findBuiltApproverApp();
  const dst = path.join(dest, APPROVER_BUNDLE_NAME);
  console.log(`Source:      ${located.path}`);
  console.log(`Destination: ${dst}`);
  if (fs.existsSync(dst)) {
    console.log(`Removing existing bundle at ${dst}...`);
    execFileSync('rm', ['-rf', dst], { stdio: 'inherit' });
  }
  execFileSync('cp', ['-R', located.path, dst], { stdio: 'inherit' });

  if (opts.cleanBuild) {
    if (located.source === 'workspace') {
      console.log(`Removing source bundle at ${located.path}...`);
      try {
        execFileSync('rm', ['-rf', located.path], { stdio: 'inherit' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`Warning: failed to remove source bundle: ${msg}. Continuing.`);
      }
    } else {
      console.log(
        '--clean-build skipped: bundle was located via OPENBOX_APPROVER_APP_PATH or ' +
          'OPENBOX_APPROVER_APP_DIR. Those paths are user-managed; not auto-deleting.',
      );
    }
  }

  console.log(
    '\nDone. Launch from Spotlight ("OpenBox Approver"). ' +
      "Run `openbox auth set-api-key` first if you haven't.",
  );
}

function uninstallApprover(dest: string): void {
  ensureMac('approver');
  const dst = path.join(dest, APPROVER_BUNDLE_NAME);
  if (!fs.existsSync(dst)) {
    console.log(`${dst} is not installed.`);
    return;
  }
  console.log(`Removing ${dst}...`);
  execFileSync('rm', ['-rf', dst], { stdio: 'inherit' });
  console.log('Done.');
}

// ---------------------------------------------------------------------------
// Extension (VS Code / Cursor .vsix)
// ---------------------------------------------------------------------------

function findVsix(): string {
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

function pickHosts(opts: { code?: boolean; cursor?: boolean }): string[] {
  if (opts.code || opts.cursor) {
    const out: string[] = [];
    if (opts.code) out.push('code');
    if (opts.cursor) out.push('cursor');
    return out;
  }
  return ['code', 'cursor'].filter((h) => whichSync(h));
}

function installExtension(opts: { code?: boolean; cursor?: boolean }): void {
  const hosts = pickHosts(opts);
  if (hosts.length === 0) {
    console.error(
      'Neither `code` nor `cursor` is on PATH. ' +
        'Install VS Code and run "Shell Command: Install \'code\' command in PATH".',
    );
    bailWith(EXIT.GENERIC);
  }
  const vsix = findVsix();
  console.log(`Using extension package: ${vsix}`);
  for (const host of hosts) {
    console.log(`Installing into ${host}...`);
    execFileSync(host, ['--install-extension', vsix], { stdio: 'inherit' });
  }
  console.log(
    "\nDone. Run `openbox auth set-api-key` if you haven't, so the extension can authenticate.",
  );
}

function uninstallExtension(opts: { code?: boolean; cursor?: boolean }): void {
  const hosts = pickHosts(opts);
  if (hosts.length === 0) {
    console.error('Neither `code` nor `cursor` is on PATH.');
    bailWith(EXIT.GENERIC);
  }
  const id = 'openbox.openbox';
  for (const host of hosts) {
    console.log(`Uninstalling from ${host}...`);
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

function installMobile(): void {
  console.log(
    `\n  iOS app: ${MOBILE_APP_STORE_URL}\n` +
      `  (Beta. App Store listing pending; the iOS app authenticates via\n` +
      `   its own login flow: no CLI install step.)\n`,
  );
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

function pickMcpTargets(opts: InstallOpts): McpTarget[] | undefined {
  const targets: McpTarget[] = [];
  if (opts.claudeDesktop) targets.push('claude-desktop');
  if (opts.cursor) targets.push('cursor');
  if (opts.claudeCode) targets.push('claude-code');
  return targets.length > 0 ? targets : undefined;
}

// ---------------------------------------------------------------------------
// `openbox install` (no target) / `openbox install all`
// Auto-detects the current platform's relevant install targets and runs
// them all. Skip with --skip <name> (repeatable). Whitelist with --only
// <name> (repeatable, mutually exclusive with --skip). Preview with
// --dry-run.
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

/** Build the run plan for `install all`. Pure: no side effects, just
 *  detection + filtering. Exported for tests. */
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

  const plan: PlanEntry[] = [];

  for (const target of INSTALL_ALL_TARGETS) {
    if (onlySet && !onlySet.has(target)) continue;
    if (skipSet.has(target)) {
      plan.push({ target, skipReason: 'excluded by --skip' });
      continue;
    }

    switch (target) {
      case 'skill':
        plan.push({
          target,
          run: async () => {
            const { installSkill } = await import('./skill.js');
            installSkill();
          },
        });
        break;

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
            // Harden is part of the full Cursor stack (mirrors what
            // `install cursor` does standalone). Consent-gated:
            // --yes auto-yes, non-interactive without --yes silently
            // skip, interactive TTY prompt y/N.
            console.log('');
            const { consent } = await import('../non-interactive.js');
            const ok = await consent(
              'Apply OpenBox enterprise hardening profile to ~/.cursor/User/settings.json (privacy mode on, cloud features off, telemetry off)?',
            );
            if (ok) {
              const { hardenCursor } = await import('../../runtime/cursor/enterprise.js');
              const r = hardenCursor({ profileName: 'enterprise-default' });
              console.log(`Applied hardening profile: ${r.profile} → ${r.file}`);
            } else {
              console.log('Skipped hardening profile (run `openbox cursor harden` later to apply).');
            }
          },
        });
        break;
      }

      case 'claude-code': {
        // Settings file may not exist yet; the parent dir reachability
        // (homedir) is what the spec checks. Run unconditionally; the
        // installer creates ~/.claude as needed.
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

      case 'mcp':
        plan.push({
          target,
          run: async () => {
            const { installMcp } = await import('../../runtime/mcp/install.js');
            installMcp({});
          },
        });
        break;

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
            // The skill installer just copies a dir; uninstall removes it.
            const dst = path.join(env.homedir(), '.claude', 'skills', 'openbox');
            if (fs.existsSync(dst)) {
              execFileSync('rm', ['-rf', dst], { stdio: 'inherit' });
              console.log(`Removed ${dst}`);
            } else {
              console.log(`${dst} is not installed.`);
            }
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
  const summary: RunSummary = { installed: [], skipped: [], failed: [] };

  for (const entry of plan) {
    if (entry.skipReason) {
      console.log(`Skipping ${entry.target}: ${entry.skipReason}`);
      summary.skipped.push({ target: entry.target, reason: entry.skipReason });
      continue;
    }
    const tag = entry.detail ? `${entry.target} (${entry.detail})` : entry.target;
    if (opts.dryRun) {
      console.log(`Would ${verb}: ${tag}`);
      summary.installed.push(entry.target);
      continue;
    }
    console.log(
      `${verb === 'install' ? 'Installing' : 'Uninstalling'} ${tag}...`,
    );
    try {
      await entry.run?.();
      summary.installed.push(entry.target);
      console.log(`  ok: ${entry.target}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.failed.push({ target: entry.target, error: msg });
      console.error(`  failed: ${entry.target}: ${msg}`);
    }
  }

  const lines: string[] = [];
  lines.push(
    `${verb === 'install' ? 'Installed' : 'Uninstalled'}: ${
      summary.installed.length > 0 ? summary.installed.join(', ') : '(none)'
    }.`,
  );
  if (summary.skipped.length > 0) {
    lines.push(
      `Skipped: ${summary.skipped
        .map((s) => `${s.target} (${s.reason})`)
        .join(', ')}.`,
    );
  }
  if (summary.failed.length > 0) {
    lines.push(
      `Failed: ${summary.failed.map((f) => `${f.target} (${f.error})`).join(', ')}.`,
    );
  }
  console.log('\n' + lines.join(' '));

  return summary;
}

interface AllCliOpts {
  skip?: string[];
  only?: string[];
  dryRun?: boolean;
}

async function runInstallAll(opts: AllCliOpts): Promise<void> {
  let plan: PlanEntry[];
  try {
    plan = planInstallAll(opts);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    bailWith(EXIT.USAGE);
    return;
  }
  const summary = await runPlan(plan, { dryRun: opts.dryRun, verb: 'install' });
  if (summary.failed.length > 0) bailWith(EXIT.GENERIC);
}

async function runUninstallAll(opts: AllCliOpts): Promise<void> {
  let plan: PlanEntry[];
  try {
    plan = planUninstallAll(opts);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    bailWith(EXIT.USAGE);
    return;
  }
  const summary = await runPlan(plan, { dryRun: opts.dryRun, verb: 'uninstall' });
  if (summary.failed.length > 0) bailWith(EXIT.GENERIC);
}

function collect(value: string, prev: string[]): string[] {
  return prev.concat([value]);
}

export function registerInstallCommands(program: Command): void {
  const install = program
    .command('install')
    .description(
      'Install an OpenBox client. With no target, auto-detects the current ' +
        "machine's relevant pieces (skill, extension, cursor hooks, claude-code " +
        'hooks, MCP, and on macOS the approver app) and installs them all.',
    )
    .option('--skip <target>', 'Skip a target by name (repeatable)', collect, [])
    .option(
      '--only <target>',
      'Only install named targets (repeatable). Mutually exclusive with --skip.',
      collect,
      [],
    )
    .option('--dry-run', 'Print what would be installed without running', false)
    .action(async (opts: AllCliOpts) => {
      await runInstallAll(opts);
    });

  install
    .command('all')
    .description(
      'Install every OpenBox piece detectable on this machine (same as ' +
        '`openbox install` with no target).',
    )
    .option('--skip <target>', 'Skip a target by name (repeatable)', collect, [])
    .option(
      '--only <target>',
      'Only install named targets (repeatable). Mutually exclusive with --skip.',
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
      'Install the full Cursor surface: hooks in ~/.cursor/hooks.json, ' +
        'the IDE extension, the MCP server entry, and (with consent) the ' +
        "enterprise hardening profile in ~/.cursor/User/settings.json. " +
        'Use --no-harden to skip the hardening prompt entirely.',
    )
    .option('--no-harden', 'Skip the enterprise hardening profile (no prompt)')
    .option(
      '--matcher <pair>',
      "Cursor hook matcher pair `<event>=<regex>`. Repeatable. Cursor " +
        'skips the hook when the matcher does not match the event input ' +
        '(shell command, file path, tool name, …), cutting process ' +
        'spawns dramatically. Example: ' +
        "--matcher 'beforeShellExecution=\\\\b(rm|sudo|curl|wget)\\\\b'",
      collect,
      [],
    )
    .action(async (opts: { harden?: boolean; matcher: string[] }) => {
      const matchers: Record<string, string> = {};
      for (const pair of opts.matcher ?? []) {
        const idx = pair.indexOf('=');
        if (idx <= 0) {
          console.error(`--matcher: invalid pair '${pair}', expected <event>=<regex>`);
          bailWith(EXIT.USAGE);
        }
        matchers[pair.slice(0, idx).trim()] = pair.slice(idx + 1);
      }
      const { installCursor } = await import('../../runtime/cursor/install.js');
      installCursor({
        matchers: Object.keys(matchers).length > 0 ? matchers : undefined,
      });
      console.log('');
      installExtension({ cursor: true });
      console.log('');
      const { installMcp } = await import('../../runtime/mcp/install.js');
      installMcp({ targets: ['cursor'] });
      if (opts.harden !== false) {
        console.log('');
        const { consent } = await import('../non-interactive.js');
        const ok = await consent(
          'Apply OpenBox enterprise hardening profile to ~/.cursor/User/settings.json (privacy mode on, cloud features off, telemetry off)?',
        );
        if (ok) {
          const { hardenCursor } = await import('../../runtime/cursor/enterprise.js');
          const r = hardenCursor({ profileName: 'enterprise-default' });
          console.log(`Applied hardening profile: ${r.profile} → ${r.file}`);
        } else {
          console.log('Skipped hardening profile (run `openbox cursor harden` later to apply).');
        }
      }
    });

  install
    .command('claude-code')
    .description(
      'Install the full Claude Code surface: hooks in ' +
        '~/.claude/settings.json, the MCP server entry in ~/.claude.json, ' +
        'and the OpenBox skill in ~/.claude/skills/openbox.',
    )
    .action(async () => {
      const { installClaudeCode } = await import('../../runtime/claude-code/install.js');
      installClaudeCode();
      console.log('');
      const { installMcp } = await import('../../runtime/mcp/install.js');
      installMcp({ targets: ['claude-code'] });
      console.log('');
      const { installSkill } = await import('./skill.js');
      installSkill();
    });

  install
    .command('mcp')
    .description(
      'Register OpenBox as an MCP server in Claude Desktop, Cursor, and ' +
        'Claude Code. Writes a config entry that points at the absolute ' +
        "path of this CLI's `dist/cli/index.js` so the host can launch the " +
        'server with no global install / npm package required.',
    )
    .option('--claude-desktop', 'Claude Desktop only', false)
    .option('--cursor', 'Cursor only', false)
    .option('--claude-code', 'Claude Code only', false)
    .action(async (opts: InstallOpts) => {
      const { installMcp } = await import('../../runtime/mcp/install.js');
      installMcp({ targets: pickMcpTargets(opts) });
    });

  install
    .command('skill')
    .description('Install the OpenBox skill (SKILL.md) into ~/.claude/skills/openbox')
    .action(async () => {
      const { installSkill } = await import('./skill.js');
      installSkill();
    });

  install
    .command('mobile')
    .description('Show the App Store link / QR for the iOS approver (placeholder)')
    .action(() => installMobile());

  const uninstall = program
    .command('uninstall')
    .description(
      'Remove an OpenBox client. With no target, mirrors `openbox install` ' +
        'and removes every piece detectable on this machine.',
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
      'Remove the full Cursor surface: hooks, IDE extension, MCP server ' +
        'entry, and any OpenBox-managed keys in ~/.cursor/User/settings.json.',
    )
    .action(async () => {
      const { uninstallCursor } = await import('../../runtime/cursor/install.js');
      uninstallCursor();
      console.log('');
      uninstallExtension({ cursor: true });
      console.log('');
      const { uninstallMcp } = await import('../../runtime/mcp/install.js');
      uninstallMcp({ targets: ['cursor'] });
      console.log('');
      const { unhardenCursor } = await import('../../runtime/cursor/enterprise.js');
      const r = unhardenCursor();
      if (r.removed.length > 0) {
        console.log(`Removed hardening profile keys (${r.removed.length}) from ${r.file}`);
      }
    });

  uninstall
    .command('claude-code')
    .description(
      'Remove the full Claude Code surface: hooks, MCP server entry, and ' +
        'the OpenBox skill at ~/.claude/skills/openbox.',
    )
    .action(async () => {
      const { uninstallClaudeCode } = await import('../../runtime/claude-code/install.js');
      uninstallClaudeCode();
      console.log('');
      const { uninstallMcp } = await import('../../runtime/mcp/install.js');
      uninstallMcp({ targets: ['claude-code'] });
      console.log('');
      const skillDst = path.join(os.homedir(), '.claude', 'skills', 'openbox');
      if (fs.existsSync(skillDst)) {
        execFileSync('rm', ['-rf', skillDst], { stdio: 'inherit' });
        console.log(`Removed ${skillDst}`);
      }
    });

  uninstall
    .command('mcp')
    .description('Remove the OpenBox MCP server entry from Claude Desktop / Cursor / Claude Code')
    .option('--claude-desktop', 'Claude Desktop only', false)
    .option('--cursor', 'Cursor only', false)
    .option('--claude-code', 'Claude Code only', false)
    .action(async (opts: InstallOpts) => {
      const { uninstallMcp } = await import('../../runtime/mcp/install.js');
      uninstallMcp({ targets: pickMcpTargets(opts) });
    });

  // Mobile has no uninstall: the iOS app is removed device-side.
}
