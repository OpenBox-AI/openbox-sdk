// Install / uninstall the OpenBox MCP entry. We write each host's
// JSON config directly (no `claude mcp add` / `cursor mcp add` shell-
// outs: those CLIs aren't a prerequisite for installing into the
// hosts they ship with). GUI hosts inherit PATH from `launchctl`,
// not the shell rc; if `openbox` lives in an nvm/shell-only path the
// host will say "command not found": fix at the host PATH level.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export type McpTarget = 'claude-desktop' | 'cursor' | 'claude-code';

const SERVER_NAME = 'openbox';

/** The MCP entry written into every host's config. */
const SERVER_ENTRY = {
  command: 'openbox',
  args: ['mcp', 'serve'],
};

interface McpHost {
  target: McpTarget;
  /** Human-readable name for log output. */
  label: string;
  /** Absolute path to the config file we write. */
  configFile: string;
  /** What to print after install so the user knows the next step. */
  postInstallNote?: string;
}

/** Claude Desktop's config path varies per OS. */
function claudeDesktopConfigPath(): string {
  if (process.platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json',
    );
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'Claude', 'claude_desktop_config.json');
  }
  // Linux: Anthropic doesn't ship an official Linux build, but the
  // unofficial builds users run all read from the XDG config home.
  const xdg = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
  return path.join(xdg, 'Claude', 'claude_desktop_config.json');
}

const HOSTS: McpHost[] = [
  {
    target: 'claude-desktop',
    label: 'Claude Desktop',
    configFile: claudeDesktopConfigPath(),
    postInstallNote: 'Restart Claude Desktop to pick up the new MCP server.',
  },
  {
    target: 'cursor',
    label: 'Cursor',
    // ~/.cursor/mcp.json is the global config Cursor reads on launch.
    // A project-local `.cursor/mcp.json` overrides it; the global file
    // is the right default for `openbox install mcp`.
    configFile: path.join(os.homedir(), '.cursor', 'mcp.json'),
    postInstallNote: 'Restart Cursor (Cmd-Q then relaunch) to pick up the new MCP server.',
  },
  {
    target: 'claude-code',
    label: 'Claude Code',
    // `~/.claude.json` is the user-scoped config current Claude Code
    // builds read; older builds use `~/.claude/mcp.json`.
    configFile: path.join(os.homedir(), '.claude.json'),
    postInstallNote: 'Restart Claude Code to pick up the new MCP server.',
  },
];

function loadConfig(file: string): Record<string, unknown> {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
  } catch {
    throw new Error(`Refusing to overwrite malformed JSON at ${file}`);
  }
}

function saveConfig(file: string, value: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf-8');
}

function pickHosts(targets: McpTarget[] | undefined): McpHost[] {
  if (!targets || targets.length === 0) return HOSTS;
  const set = new Set(targets);
  return HOSTS.filter((h) => set.has(h.target));
}

export interface McpInstallOpts {
  /** Pick specific hosts. Empty / undefined = install into every
   *  known host. */
  targets?: McpTarget[];
}

export function installMcp(opts: McpInstallOpts = {}): void {
  console.log(
    `MCP server entry written into each host's config:\n` +
      `  ${SERVER_ENTRY.command} ${SERVER_ENTRY.args.join(' ')}\n` +
      `  (the host launches the openbox CLI directly; make sure it's on the\n` +
      `   host's PATH: see comment in this module if Claude Desktop says\n` +
      `   "openbox: command not found")\n`,
  );

  for (const host of pickHosts(opts.targets)) {
    const cfg = loadConfig(host.configFile);
    const servers = (cfg.mcpServers as Record<string, unknown> | undefined) ?? {};
    servers[SERVER_NAME] = SERVER_ENTRY;
    cfg.mcpServers = servers;
    saveConfig(host.configFile, cfg);
    console.log(`  ✓ ${host.label.padEnd(16)} ${host.configFile}`);
  }

  console.log('\nNext step:');
  for (const host of pickHosts(opts.targets)) {
    if (host.postInstallNote) {
      console.log(`  ${host.label}: ${host.postInstallNote}`);
    }
  }
}

export function uninstallMcp(opts: McpInstallOpts = {}): void {
  for (const host of pickHosts(opts.targets)) {
    if (!fs.existsSync(host.configFile)) {
      console.log(`  - ${host.label.padEnd(16)} ${host.configFile} not present`);
      continue;
    }
    const cfg = loadConfig(host.configFile);
    const servers = cfg.mcpServers as Record<string, unknown> | undefined;
    if (!servers || !(SERVER_NAME in servers)) {
      console.log(`  - ${host.label.padEnd(16)} no openbox entry found`);
      continue;
    }
    delete servers[SERVER_NAME];
    if (Object.keys(servers).length === 0) {
      delete cfg.mcpServers;
    } else {
      cfg.mcpServers = servers;
    }
    saveConfig(host.configFile, cfg);
    console.log(`  ✓ ${host.label.padEnd(16)} removed openbox entry`);
  }
}
