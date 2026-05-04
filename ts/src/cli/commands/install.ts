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

export function registerInstallCommands(program: Command): void {
  const install = program
    .command('install')
    .description('Install an OpenBox client (approver, extension, cursor, claude-code, skill, mobile)');

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
      "Install everything OpenBox needs in Cursor: the IDE extension, " +
        "the runtime hooks in ~/.cursor/User/settings.json, and the MCP " +
        "server entry. Pass --hooks-only to install just the runtime hooks " +
        "(legacy behavior); --no-extension / --no-mcp to skip individual " +
        "pieces.",
    )
    .option('--hooks-only', 'Install only the runtime hooks; skip extension and MCP', false)
    .option('--no-extension', 'Skip installing the IDE extension', false)
    .option('--no-mcp', 'Skip registering the MCP server entry', false)
    .action(async (opts: InstallOpts & { hooksOnly?: boolean; extension?: boolean; mcp?: boolean }) => {
      const { installCursor } = await import('../../runtime/cursor/install.js');
      installCursor();
      if (opts.hooksOnly) return;
      if (opts.extension !== false) {
        console.log('');
        installExtension({ cursor: true });
      }
      if (opts.mcp !== false) {
        console.log('');
        const { installMcp } = await import('../../runtime/mcp/install.js');
        installMcp({ targets: ['cursor'] });
      }
    });

  install
    .command('claude-code')
    .description('Install OpenBox hooks into ~/.claude/settings.json')
    .action(async () => {
      const { installClaudeCode } = await import('../../runtime/claude-code/install.js');
      installClaudeCode();
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
    .description('Remove an OpenBox client (approver, extension, cursor, claude-code, skill)');

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
      "Remove everything OpenBox installed in Cursor: the runtime hooks, " +
        "the IDE extension, and the MCP server entry. Pass --hooks-only " +
        "to remove just the runtime hooks; --no-extension / --no-mcp to " +
        "skip individual pieces.",
    )
    .option('--hooks-only', 'Uninstall only the runtime hooks; skip extension and MCP', false)
    .option('--no-extension', 'Skip uninstalling the IDE extension', false)
    .option('--no-mcp', 'Skip removing the MCP server entry', false)
    .action(async (opts: InstallOpts) => {
      const { uninstallCursor } = await import('../../runtime/cursor/install.js');
      uninstallCursor();
      if (opts.hooksOnly) return;
      if (opts.extension !== false) {
        console.log('');
        uninstallExtension({ cursor: true });
      }
      if (opts.mcp !== false) {
        console.log('');
        const { uninstallMcp } = await import('../../runtime/mcp/install.js');
        uninstallMcp({ targets: ['cursor'] });
      }
    });

  uninstall
    .command('claude-code')
    .description('Remove OpenBox hooks from ~/.claude/settings.json')
    .action(async () => {
      const { uninstallClaudeCode } = await import('../../runtime/claude-code/install.js');
      uninstallClaudeCode();
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
