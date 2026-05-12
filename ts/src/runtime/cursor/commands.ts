// Cursor "bundle" installers; slash commands, project rules, and
// plugin agents. All three are flat directories of markdown files
// copied verbatim from a repo-root source dir to a per-user
// `~/.cursor/<kind>/` dir, so they share one helper.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface BundleKind {
  /** Repo-root source dir name (e.g. `cursor-commands`). */
  src: string;
  /** Per-user target dir name under `~/.cursor/` (e.g. `commands`). */
  dst: string;
  /** File extension to copy (e.g. `.md` for commands/agents, `.mdc` for rules). */
  ext: string;
  /** Human-readable label printed in the CLI summary. */
  label: string;
  /** Slash-prefix shown next to each installed name in the summary;
   *  empty string when the kind isn't invoked as a slash command. */
  slashPrefix?: string;
}

const BUNDLES: Record<'commands' | 'rules' | 'agents', BundleKind> = {
  commands: { src: 'commands', dst: 'commands', ext: '.md', label: 'slash command', slashPrefix: '/' },
  rules: { src: 'rules', dst: 'rules', ext: '.mdc', label: 'project rule' },
  agents: { src: 'agents', dst: 'agents', ext: '.md', label: 'plugin agent' },
};

function findSourceDir(srcName: string): string {
  // Sources live under `apps/cursor-plugin/src/<kind>/` alongside
  // the plugin they belong to. From `dist/runtime/cursor` or
  // `ts/src/runtime/cursor` we walk up to the repo root and look
  // there.
  const candidates = [
    path.resolve(__dirname, '../../../apps/cursor-plugin/src', srcName),
    path.resolve(__dirname, '../../../../apps/cursor-plugin/src', srcName),
    path.resolve(__dirname, '../../apps/cursor-plugin/src', srcName),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.readdirSync(c).some((f) => f.endsWith('.md') || f.endsWith('.mdc'))) {
      return c;
    }
  }
  throw new Error(
    `Couldn't find apps/cursor-plugin/src/${srcName}/ in any of:\n${candidates.map((c) => `  - ${c}`).join('\n')}`,
  );
}

function bundleTargetDir(dstName: string): string {
  return path.join(os.homedir(), '.cursor', dstName);
}

function installBundle(kind: BundleKind, opts: { target?: string }): string {
  const src = findSourceDir(kind.src);
  const dst = opts.target ? path.resolve(opts.target) : bundleTargetDir(kind.dst);
  fs.mkdirSync(dst, { recursive: true });
  const installed: string[] = [];
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(kind.ext)) continue;
    fs.copyFileSync(path.join(src, entry.name), path.join(dst, entry.name));
    installed.push(entry.name);
  }
  // eslint-disable-next-line no-console
  console.log(
    `Installed ${installed.length} Cursor ${kind.label}${installed.length === 1 ? '' : 's'} → ${dst}\n` +
      installed.map((n) => `  ${kind.slashPrefix ?? ''}${n.replace(new RegExp(`\\${kind.ext}$`), '')}`).join('\n'),
  );
  return dst;
}

function uninstallBundle(kind: BundleKind, opts: { target?: string }): void {
  const src = findSourceDir(kind.src);
  const dst = opts.target ? path.resolve(opts.target) : bundleTargetDir(kind.dst);
  if (!fs.existsSync(dst)) {
    // eslint-disable-next-line no-console
    console.log(`${dst} is not present; nothing to remove.`);
    return;
  }
  let removed = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(kind.ext)) continue;
    const target = path.join(dst, entry.name);
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
      removed++;
    }
  }
  // eslint-disable-next-line no-console
  console.log(`Removed ${removed} OpenBox ${kind.label}${removed === 1 ? '' : 's'} from ${dst}.`);
}

// Slash commands ---------------------------------------------------

export function commandsTargetDir(): string {
  return bundleTargetDir(BUNDLES.commands.dst);
}
export function installCursorCommands(opts: { target?: string } = {}): string {
  return installBundle(BUNDLES.commands, opts);
}
export function uninstallCursorCommands(opts: { target?: string } = {}): void {
  uninstallBundle(BUNDLES.commands, opts);
}

// Project rules ----------------------------------------------------

export function rulesTargetDir(): string {
  return bundleTargetDir(BUNDLES.rules.dst);
}
export function installCursorRules(opts: { target?: string } = {}): string {
  return installBundle(BUNDLES.rules, opts);
}
export function uninstallCursorRules(opts: { target?: string } = {}): void {
  uninstallBundle(BUNDLES.rules, opts);
}

// Plugin agents ----------------------------------------------------

export function agentsTargetDir(): string {
  return bundleTargetDir(BUNDLES.agents.dst);
}
export function installCursorAgents(opts: { target?: string } = {}): string {
  return installBundle(BUNDLES.agents, opts);
}
export function uninstallCursorAgents(opts: { target?: string } = {}): void {
  uninstallBundle(BUNDLES.agents, opts);
}
