// Headless-on-macOS patches for the test-only VS Code download. Two
// layered patches; both target ONLY the cached copy under
// `.wdio-vscode-service/` and never the developer's daily Cursor
// or VS Code install.
//
//   1. Info.plist: LSUIElement = 1
//      Removes Dock icon + Cmd-Tab entry + menu bar. Persistent
//      property of the app bundle.
//
//   2. out/main.js: prepend app.setActivationPolicy('accessory')
//      The actual focus-theft fix. The wdio research path made it
//      clear that no Electron CLI flag, no plist entry, and no
//      post-launch osascript hider can prevent the AppKit
//      activation that fires when chromedriver attaches via CDP.
//      The fix has to live INSIDE the main process — flipping the
//      activation policy to 'accessory' before app.whenReady()
//      resolves makes [NSApp activate] calls no-ops at the OS
//      level. Windows still create normally, so chromedriver works
//      fine; the app simply never enters the active-app rotation.
//
// Both are idempotent — re-runnable; skip silently when already
// applied / not on macOS / no cache yet.

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

const SENTINEL = '/* openbox-test-headless: setActivationPolicy injected */';
const ACTIVATION_PREPEND = `${SENTINEL}
import { app as __obxApp } from 'electron';
try {
  if (process.platform === 'darwin') __obxApp.setActivationPolicy('accessory');
} catch { /* noop */ }
`;

let plistPatched = 0;
let plistAlready = 0;
let mainPatched = 0;
let mainAlready = 0;

for (const dir of versionDirs) {
  const appRoot = join(CACHE_DIR, dir, 'Visual Studio Code.app');

  // ── 1. LSUIElement on Info.plist ──────────────────────────────
  const plist = join(appRoot, 'Contents', 'Info.plist');
  if (existsSync(plist)) {
    const content = readFileSync(plist, 'utf-8');
    if (content.includes('<key>LSUIElement</key>')) {
      plistAlready++;
    } else {
      const next = content.replace(
        /<\/dict>\n<\/plist>\s*$/,
        '\t<key>LSUIElement</key>\n\t<true/>\n</dict>\n</plist>\n',
      );
      if (next !== content) {
        writeFileSync(plist, next);
        plistPatched++;
        log(`Info.plist patched: ${dir}`);
      }
    }
  }

  // ── 2. setActivationPolicy('accessory') in out/main.js ────────
  const mainJs = join(appRoot, 'Contents', 'Resources', 'app', 'out', 'main.js');
  if (existsSync(mainJs)) {
    const content = readFileSync(mainJs, 'utf-8');
    if (content.includes(SENTINEL)) {
      mainAlready++;
    } else {
      writeFileSync(mainJs, ACTIVATION_PREPEND + content);
      mainPatched++;
      log(`main.js patched: ${dir}`);
    }
  }
}

log(
  `done — Info.plist: ${plistPatched} patched, ${plistAlready} already; ` +
    `main.js: ${mainPatched} patched, ${mainAlready} already`,
);
