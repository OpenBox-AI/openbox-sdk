/** `openbox skill path`: print the bundled skill source dir. Install
 *  lives at `openbox install skill`; `installSkill()` here is the
 *  function the unified command imports. */

import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { info, success } from '../output.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findSkillSourceDir(): string {
  // Search up from the running CLI location. Inside the published
  // package, dist/cli/index.js sits next to dist/skill/. In dev (running
  // from ts/src/cli/commands/skill.ts), the source is at <repo>/skill/.
  const candidates = [
    path.resolve(__dirname, '../../../../skill'),       // dist/cli/commands → repo root /skill
    path.resolve(__dirname, '../../skill'),             // dist/cli → dist/skill
    path.resolve(__dirname, '../../../skill'),          // ts/src/cli/commands → repo root /skill
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'SKILL.md'))) return c;
  }
  throw new Error(
    `Couldn't find SKILL.md in any of:\n${candidates.map((c) => `  - ${c}`).join('\n')}`,
  );
}

function copyDir(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

export interface SkillInstallOpts {
  /** Override the install destination. Defaults to the per-host
   *  `~/.claude/skills/openbox` (or `~/.cursor/skills/openbox` when
   *  `cursor` is true). */
  target?: string;
  /** Install into Cursor's skill dir instead of Claude Code's. */
  cursor?: boolean;
}

/**
 * Copy the bundled skill content into the target host's skills dir.
 * Returns the resolved destination path so callers can echo it.
 */
export function installSkill(opts: SkillInstallOpts = {}): string {
  const src = findSkillSourceDir();
  const dst = opts.target
    ? path.resolve(opts.target)
    : path.join(os.homedir(), opts.cursor ? '.cursor' : '.claude', 'skills', 'openbox');
  copyDir(src, dst);
  success(`skill installed → ${dst}`);
  return dst;
}

export function registerSkillCommands(program: Command) {
  const skill = program.command('skill').description('OpenBox skill content (SKILL.md + references)');

  skill
    .command('path')
    .description('Print the source path of the bundled skill content')
    .action(() => {
      info(findSkillSourceDir());
    });
}
