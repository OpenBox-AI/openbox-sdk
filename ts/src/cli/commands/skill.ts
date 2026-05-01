import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

/**
 * `openbox skill install`; copies the OpenBox skill content (SKILL.md +
 * references) into the user's `.claude/skills/openbox/` (or
 * `.cursor/skills/openbox/`) directory so Claude Code / Cursor can load
 * the skill.
 *
 * The skill content is shipped INSIDE the openbox-sdk package (under
 * dist/skill/; see package.json `files`). At install time we copy it
 * to the user's home dir.
 */

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

export function registerSkillCommands(program: Command) {
  const skill = program.command('skill').description('OpenBox skill content (SKILL.md + references)');

  skill
    .command('install')
    .description('Copy SKILL.md + references into ~/.claude/skills/openbox/ (and ~/.cursor/skills/openbox/ if Cursor is installed)')
    .option('--target <dir>', 'override install destination (default: ~/.claude/skills/openbox/)')
    .option('--cursor', 'install into ~/.cursor/skills/openbox/ instead of ~/.claude/')
    .action((opts: { target?: string; cursor?: boolean }) => {
      const src = findSkillSourceDir();
      const dst = opts.target
        ? path.resolve(opts.target)
        : path.join(os.homedir(), opts.cursor ? '.cursor' : '.claude', 'skills', 'openbox');
      copyDir(src, dst);
      // eslint-disable-next-line no-console
      console.log(`Installed openbox skill → ${dst}`);
    });

  skill
    .command('path')
    .description('Print the source path of the bundled skill content')
    .action(() => {
      // eslint-disable-next-line no-console
      console.log(findSkillSourceDir());
    });
}
