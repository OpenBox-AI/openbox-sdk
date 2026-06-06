import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EXIT, bailWith } from '../exit-codes.js';
import { action, error, info, kv, success, warn } from '../output.js';

export const APPROVER_BUNDLE_NAME = 'OpenBox Approver.app';
export const APPLICATIONS_DIR = '/Applications';

// Cap walk-up so a missing workspace marker doesn't iterate to filesystem root
// (or worse, hang on a network mount). 8 levels covers nested worktrees plus
// reasonable subdirectory depth.
const WORKSPACE_WALK_LIMIT = 8;

// Bundle paths inside the workspace, in priority order. Cargo workspace builds
// land in `target/`; per-crate builds may land under `apps/approver/...`. We
// check all three so users don't need an env override regardless of layout.
const WORKSPACE_BUNDLE_CANDIDATES = [
  ['target', 'release', 'bundle', 'macos', APPROVER_BUNDLE_NAME],
  [
    'apps',
    'approver',
    'src-tauri',
    'target',
    'release',
    'bundle',
    'macos',
    APPROVER_BUNDLE_NAME,
  ],
  [
    'apps',
    'approver',
    'target',
    'release',
    'bundle',
    'macos',
    APPROVER_BUNDLE_NAME,
  ],
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
export function findBuiltApproverApp(
  cwd: string = process.cwd(),
): ApproverBundleLocation {
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
  info(
    'Launch from Spotlight ("OpenBox Approver"). Run `openbox auth set-api-key` first if you haven\'t.',
  );
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
