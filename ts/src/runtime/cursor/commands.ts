// Cursor slash-command installer. Cursor reads markdown command
// definitions from `~/.cursor/commands/*.md` and exposes them as
// `/<name>` in chat. We bundle four under `cursor-commands/` at the
// repo root and copy them in.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findCommandsSourceDir(): string {
  // Mirror skill.ts's resolution. From dist/runtime/cursor → repo root /cursor-commands.
  // From ts/src/runtime/cursor (dev) → repo root /cursor-commands.
  const candidates = [
    path.resolve(__dirname, '../../../cursor-commands'),
    path.resolve(__dirname, '../../../../cursor-commands'),
    path.resolve(__dirname, '../../cursor-commands'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.readdirSync(c).some((f) => f.endsWith('.md'))) {
      return c;
    }
  }
  throw new Error(
    `Couldn't find cursor-commands/ in any of:\n${candidates.map((c) => `  - ${c}`).join('\n')}`,
  );
}

export function commandsTargetDir(): string {
  return path.join(os.homedir(), '.cursor', 'commands');
}

export function installCursorCommands(opts: { target?: string } = {}): string {
  const src = findCommandsSourceDir();
  const dst = opts.target ? path.resolve(opts.target) : commandsTargetDir();
  fs.mkdirSync(dst, { recursive: true });
  const installed: string[] = [];
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    fs.copyFileSync(path.join(src, entry.name), path.join(dst, entry.name));
    installed.push(entry.name);
  }
  // eslint-disable-next-line no-console
  console.log(
    `Installed ${installed.length} Cursor slash command${installed.length === 1 ? '' : 's'} → ${dst}\n` +
      installed.map((n) => `  /${n.replace(/\.md$/, '')}`).join('\n'),
  );
  return dst;
}

export function uninstallCursorCommands(opts: { target?: string } = {}): void {
  const src = findCommandsSourceDir();
  const dst = opts.target ? path.resolve(opts.target) : commandsTargetDir();
  if (!fs.existsSync(dst)) {
    // eslint-disable-next-line no-console
    console.log(`${dst} is not present; nothing to remove.`);
    return;
  }
  let removed = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const target = path.join(dst, entry.name);
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
      removed++;
    }
  }
  // eslint-disable-next-line no-console
  console.log(`Removed ${removed} OpenBox slash command${removed === 1 ? '' : 's'} from ${dst}.`);
}
