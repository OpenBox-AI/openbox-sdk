// Make the test-only VS Code download invisible on macOS — no Dock
// icon, no Cmd-Tab entry, no focus steal. The wdio LIVE suite needs
// a real Electron workbench (chromedriver attaches to the window),
// so we can't run truly headless on macOS. The next-best thing is
// LSUIElement = 1, which tells macOS the app is a "background-only
// agent" — the window still renders (chromedriver is happy) but the
// OS treats it as invisible from the user's POV.
//
// IMPORTANT: this patches ONLY the cached test copy under
// `.wdio-vscode-service/` — never the developer's real VS Code or
// Cursor install. If you point OPENBOX_E2E_VSCODE_BINARY at your
// daily-driver Cursor, this script does nothing for that path.
//
// Re-runnable. Idempotent. Skips silently when nothing to patch
// (non-macOS, no cache yet, already patched).

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = resolve(HERE, '..', '.wdio-vscode-service');

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[patch-headless-mac] ${msg}`);
}

if (process.platform !== 'darwin') {
  log('not macOS; nothing to do');
  process.exit(0);
}

if (!existsSync(CACHE_DIR)) {
  log('no .wdio-vscode-service cache yet; first test run will create it');
  process.exit(0);
}

const versionDirs = readdirSync(CACHE_DIR).filter((n) => n.startsWith('vscode-darwin-'));
if (versionDirs.length === 0) {
  log('no vscode-darwin-* dir in cache yet');
  process.exit(0);
}

let patched = 0;
let already = 0;

for (const dir of versionDirs) {
  const plist = join(CACHE_DIR, dir, 'Visual Studio Code.app', 'Contents', 'Info.plist');
  if (!existsSync(plist)) {
    log(`skip ${dir}: Info.plist not found`);
    continue;
  }
  const content = readFileSync(plist, 'utf-8');
  if (content.includes('<key>LSUIElement</key>')) {
    already++;
    continue;
  }
  // Insert LSUIElement immediately before the closing </dict> of
  // the top-level plist. The keys are tab-indented in VS Code's
  // Info.plist; match that style.
  const next = content.replace(
    /<\/dict>\n<\/plist>\s*$/,
    '\t<key>LSUIElement</key>\n\t<true/>\n</dict>\n</plist>\n',
  );
  if (next === content) {
    log(`skip ${dir}: could not find </dict></plist> tail to patch`);
    continue;
  }
  writeFileSync(plist, next);
  patched++;
  log(`patched ${dir}`);
}

log(`done — patched ${patched}, already-patched ${already}`);
