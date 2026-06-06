import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT, bailWith } from '../exit-codes.js';
import { action, error, info, success } from '../output.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

export function whichSync(bin: string): string | null {
  try {
    const result = execFileSync('which', [bin], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return result.toString('utf-8').trim() || null;
  } catch {
    return null;
  }
}

export function pickHosts(opts: {
  code?: boolean;
  cursor?: boolean;
}): string[] {
  if (opts.code || opts.cursor) {
    const out: string[] = [];
    if (opts.code) out.push('code');
    if (opts.cursor) out.push('cursor');
    return out;
  }
  return ['code', 'cursor'].filter((h) => whichSync(h));
}

export function installExtension(opts: {
  code?: boolean;
  cursor?: boolean;
}): void {
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
      help: 'install VS Code and run "Shell Command: Install \'code\' command in PATH"',
    });
    bailWith(EXIT.GENERIC);
  }
  const vsix = findVsix();
  info(`Using extension package: ${vsix}`);
  for (const host of hosts) {
    action('Installing into', host);
    execFileSync(host, ['--install-extension', vsix, '--force'], {
      stdio: 'inherit',
    });
  }
  success('extension installed');
  info(
    "Run `openbox auth set-api-key` if you haven't, so the extension can authenticate.",
  );
}

export function uninstallExtension(opts: {
  code?: boolean;
  cursor?: boolean;
}): void {
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
