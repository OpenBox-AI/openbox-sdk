// Install / uninstall the OpenBox MCP entry for project-scoped host
// integrations. We write project JSON config directly (no `claude mcp
// add` / `cursor mcp add` shell-outs: those CLIs aren't a prerequisite
// for installing into the hosts they ship with).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { HOOK_SPEC as CODEX_HOOK_SPEC } from '../../core-client/generated/runtime/codex.js';
import { installMcpEntry, uninstallMcpEntry } from '../../install/from-spec.js';

export type McpTarget = 'cursor' | 'claude-code' | 'codex';
export type McpScope = 'project';

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

/** Resolve the project-scoped MCP config path for each host. */
function projectConfigPath(target: McpTarget, cwd: string): string {
  switch (target) {
    case 'cursor':
      return path.join(cwd, '.cursor', 'mcp.json');
    case 'claude-code':
      return path.join(cwd, '.mcp.json');
    case 'codex':
      return path.join(cwd, '.codex', 'config.toml');
  }
}

const HOSTS: McpHost[] = [
  {
    target: 'cursor',
    label: 'Cursor',
    configFile: '',
    postInstallNote: 'Restart Cursor (Cmd-Q then relaunch) to pick up the new MCP server.',
  },
  {
    target: 'claude-code',
    label: 'Claude Code',
    configFile: '',
    postInstallNote: 'Restart Claude Code to pick up the new MCP server.',
  },
  {
    target: 'codex',
    label: 'Codex',
    configFile: '',
    postInstallNote: 'Restart Codex from a trusted project to pick up .codex/config.toml.',
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
  /** Pick specific hosts. Empty / undefined means every known host. */
  targets?: McpTarget[];
  /** Project-only scope. Defaults to `project`; user-level installs are not supported. */
  scope?: McpScope;
  /** Project root for the MCP config. Defaults to `process.cwd()`. */
  cwd?: string;
}

function resolveHost(host: McpHost, scope: McpScope, cwd: string): McpHost {
  if (scope !== 'project') {
    throw new Error(`scope \`${scope}\` is not supported; expected project`);
  }
  return { ...host, configFile: projectConfigPath(host.target, cwd) };
}

export function installMcp(opts: McpInstallOpts = {}): void {
  console.log(
    `MCP server entry written into each host's config:\n` +
      `  ${SERVER_ENTRY.command} ${SERVER_ENTRY.args.join(' ')}\n` +
      `  (the host launches the openbox CLI directly; make sure it's on the\n` +
      `   host's PATH: see comment in this module if Claude Desktop says\n` +
      `   "openbox: command not found")\n`,
  );

  const scope = opts.scope ?? 'project';
  const cwd = opts.cwd ?? process.cwd();

  for (const base of pickHosts(opts.targets)) {
    const host = resolveHost(base, scope, cwd);
    if (host.target === 'codex') {
      installMcpEntry(CODEX_HOOK_SPEC, SERVER_NAME, SERVER_ENTRY, { scope, cwd });
      console.log(`  ✓ ${host.label.padEnd(16)} ${host.configFile}`);
      continue;
    }
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
  const scope = opts.scope ?? 'project';
  const cwd = opts.cwd ?? process.cwd();
  for (const base of pickHosts(opts.targets)) {
    const host = resolveHost(base, scope, cwd);
    if (host.target === 'codex') {
      uninstallMcpEntry(CODEX_HOOK_SPEC, SERVER_NAME, { scope, cwd });
      continue;
    }
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
