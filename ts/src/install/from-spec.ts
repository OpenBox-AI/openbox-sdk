// Shared install / uninstall primitive used by runtime adapters whose
// host reads hook config files directly. Per-adapter install modules
// load their generated `HOOK_SPEC` (file path, JSON key, per-event
// style, hook command) and call `installAdapter` / `uninstallAdapter`;
// all JSON-merge work lives here, so adding a new adapter is a matter
// of declaring `@hookTarget` in the spec.
//
// Scope. Host installs are project-only. The spec-emitted paths may
// still contain historical user-level defaults, but this primitive
// rewrites them to the current project so OpenBox never silently
// installs Cursor or Claude Code runtime files under the user's home
// directory.
//
// Scope rewriting happens entirely in this module; the spec-emitted
// paths stay as-is.
//
// The MCP server entry can be installed alongside the hooks via
// `installMcpEntry`. The wire format differs per host:
//
//   - Cursor reads `mcpServers` from `<cwd>/.cursor/mcp.json`.
//   - Claude Code reads `mcpServers` from `<cwd>/.mcp.json`.
//   - Codex reads `[mcp_servers.<name>]` from trusted
//     `<cwd>/.codex/config.toml`; plugin bundles can still carry
//     `.mcp.json`.

import fs from 'node:fs';
import path from 'node:path';

export type InstallScope = 'project';

export interface HookSpec {
  file: string;
  key: string;
  style: 'claude-array' | 'codex-array' | 'cursor-keyed';
  command: string;
  configDir: string;
  events: Array<{
    name: string;
    timeout?: number;
    /** False for invasive/special hooks that require an explicit opt-in. */
    installDefault?: boolean;
    /**
     * Cursor-only: regex string scoping when this hook fires.
     * Cursor skips invoking the hook command entirely if the
     * matcher does not hit, so a properly-scoped matcher cuts
     * process spawns by an order of magnitude for shell-heavy
     * sessions. Optional; absent means the hook fires on every
     * occurrence.
     *
     * Matcher semantics differ per Cursor event:
     *   beforeShellExecution → matched against the command string
     *   beforeReadFile / afterFileEdit → matched against file_path
     *   preToolUse → matched against tool_name
     */
    matcher?: string;
  }>;
}

export interface InstallOptions {
  /** Scope of the install. Defaults to `project`; host-level installs are not supported. */
  scope?: InstallScope;
  /** Project root used for the install. Defaults to `process.cwd()`. */
  cwd?: string;
}

interface ResolvedPaths {
  scope: InstallScope;
  /** Path the hook block is written to. */
  hooksFile: string;
  /** Directory that holds the host's `config.json` template. */
  configDir: string;
  /** Path the MCP `mcpServers` map is written to. */
  mcpFile: string;
  /** Key under which MCP servers live in `mcpFile`. */
  mcpKey: 'mcpServers';
}

/** Compute concrete file paths for the given scope. Pure: a unit
 *  test can call this without touching disk. */
export function resolveInstallPaths(
  spec: HookSpec,
  options: InstallOptions = {},
): ResolvedPaths {
  const scope = options.scope ?? 'project';
  const cwd = options.cwd ?? process.cwd();
  if (scope !== 'project') {
    throw new Error(`scope \`${scope}\` is not supported; expected project`);
  }

  if (spec.style === 'claude-array') {
    return {
      scope,
      hooksFile: path.join(cwd, '.claude', 'settings.json'),
      configDir: path.join(cwd, '.openbox', 'claude-code'),
      mcpFile: path.join(cwd, '.mcp.json'),
      mcpKey: 'mcpServers',
    };
  }

  if (spec.style === 'codex-array') {
    return {
      scope,
      hooksFile: path.join(cwd, '.codex', 'hooks.json'),
      configDir: path.join(cwd, '.openbox', 'codex'),
      mcpFile: path.join(cwd, '.codex', 'config.toml'),
      mcpKey: 'mcpServers',
    };
  }

  return {
    scope,
    hooksFile: path.join(cwd, '.cursor', 'hooks.json'),
    configDir: path.join(cwd, '.openbox', 'cursor'),
    mcpFile: path.join(cwd, '.cursor', 'mcp.json'),
    mcpKey: 'mcpServers',
  };
}

function loadJson(file: string): Record<string, unknown> {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
    }
  } catch {
    /* start fresh */
  }
  return {};
}

function saveJson(file: string, value: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf-8');
}

function saveText(file: string, value: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, 'utf-8');
}

interface ClaudeInnerHook {
  type: string;
  command: string;
  timeout?: number;
}
interface ClaudeRuleEntry {
  matcher?: string;
  hooks: ClaudeInnerHook[];
}

function ruleIsOpenBox(rule: ClaudeRuleEntry, command: string): boolean {
  return rule.hooks?.some(
    (h) =>
      h.command === command ||
      h.command?.includes('openbox claude-code') ||
      h.command?.includes('openbox cursor') ||
      h.command?.includes('openbox codex'),
  ) ?? false;
}

function isCursorOpenBoxHook(value: unknown, command: string): boolean {
  if (!value) return false;
  if (Array.isArray(value)) {
    return value.some((e) => isCursorOpenBoxHook(e, command));
  }
  if (typeof value !== 'object') return false;
  const cmd = (value as { command?: string }).command;
  return cmd === command || cmd?.includes('openbox cursor') === true;
}

function dropExampleConfig(configDir: string): void {
  fs.mkdirSync(configDir, { recursive: true });
  const file = path.join(configDir, 'config.json');
  if (fs.existsSync(file)) return;
  const example = {
    hitlEnabled: true,
    hitlMaxWait: 300,
    verbose: false,
  };
  // Mode 0o600: runtime settings can contain local paths and policy
  // knobs, so keep the file private from creation. Runtime secrets
  // belong in each host's official local env surface.
  fs.writeFileSync(file, JSON.stringify(example, null, 2) + '\n', { mode: 0o600, encoding: 'utf-8' });
  // eslint-disable-next-line no-console
  console.log(`Created example config at ${file}`);
  // eslint-disable-next-line no-console
  console.log('  -> Set host-local OPENBOX_API_KEY and OPENBOX_CORE_URL env to enable governance');
}

export function installAdapter(spec: HookSpec, options: InstallOptions = {}): void {
  const paths = resolveInstallPaths(spec, options);
  const settings = loadJson(paths.hooksFile);

  if (spec.style === 'claude-array' || spec.style === 'codex-array') {
    let hooksBlock = settings[spec.key] as Record<string, ClaudeRuleEntry[]> | undefined;
    if (!hooksBlock) {
      hooksBlock = {};
      settings[spec.key] = hooksBlock;
    }
    for (const evt of spec.events.filter((event) => event.installDefault !== false)) {
      if (!hooksBlock[evt.name]) hooksBlock[evt.name] = [];
      hooksBlock[evt.name] = hooksBlock[evt.name].filter((r) => !ruleIsOpenBox(r, spec.command));
      const inner: ClaudeInnerHook = { type: 'command', command: spec.command };
      if (evt.timeout) inner.timeout = evt.timeout;
      hooksBlock[evt.name].push({ hooks: [inner] });
    }
  } else {
    // cursor-keyed: `events[evt] = [{ command, timeout?, matcher? }]`.
    // The hook block is always the array form so `hooks.json` has
    // one shape regardless of whether matchers are configured.
    // Cursor honors both shapes, but the array form is the only one
    // that supports matchers; standardizing on it keeps the file
    // uniform.
    //
    // `timeout` is in seconds (Cursor's hook protocol; the bundle's
    // validator warns above 3600s). Without an explicit timeout
    // Cursor falls back to 60s, which is far too short for
    // human-in-the-loop approval. Gating events in the spec declare
    // `@installTimeout(...)`; the value lands here.
    type CursorEntry = { command: string; timeout?: number; matcher?: string };
    let hooksBlock = settings[spec.key] as
      | Record<string, CursorEntry[]>
      | undefined;
    if (!hooksBlock) {
      hooksBlock = {};
      settings[spec.key] = hooksBlock;
    }
    for (const evt of spec.events.filter((event) => event.installDefault !== false)) {
      const entry: CursorEntry = { command: spec.command };
      if (evt.timeout) entry.timeout = evt.timeout;
      if (evt.matcher) entry.matcher = evt.matcher;
      hooksBlock[evt.name] = [entry];
    }
  }

  saveJson(paths.hooksFile, settings);
  // eslint-disable-next-line no-console
  console.log(`Installed OpenBox hooks (${paths.scope}) into ${paths.hooksFile}`);
  // eslint-disable-next-line no-console
  console.log(`Hook events: ${spec.events.filter((event) => event.installDefault !== false).map((e) => e.name).join(', ')}`);

  dropExampleConfig(paths.configDir);
}

export function uninstallAdapter(spec: HookSpec, options: InstallOptions = {}): void {
  const paths = resolveInstallPaths(spec, options);
  const settings = loadJson(paths.hooksFile);
  const hooksBlock = settings[spec.key];
  if (!hooksBlock || typeof hooksBlock !== 'object') {
    // eslint-disable-next-line no-console
    console.log(`No hooks configured at ${paths.hooksFile}. Nothing to uninstall.`);
    return;
  }

  let removed = 0;
  if (spec.style === 'claude-array' || spec.style === 'codex-array') {
    const block = hooksBlock as Record<string, ClaudeRuleEntry[]>;
    for (const evt of Object.keys(block)) {
      const before = block[evt].length;
      block[evt] = block[evt].filter((r) => !ruleIsOpenBox(r, spec.command));
      removed += before - block[evt].length;
      if (block[evt].length === 0) delete block[evt];
    }
    if (Object.keys(block).length === 0) delete settings[spec.key];
  } else {
    const block = hooksBlock as Record<string, unknown>;
    for (const evt of spec.events) {
      if (isCursorOpenBoxHook(block[evt.name], spec.command)) {
        delete block[evt.name];
        removed += 1;
      }
    }
    if (Object.keys(block).length === 0) delete settings[spec.key];
  }

  saveJson(paths.hooksFile, settings);
  // eslint-disable-next-line no-console
  console.log(`Removed ${removed} OpenBox hook(s) from ${paths.hooksFile}`);
}

export interface McpServerEntry {
  command: string;
  args?: string[];
}

/**
 * Writes an MCP server entry into the host's configured location
 * for the chosen scope. Used by `openbox install <host>` so the
 * MCP server registration follows the same scope as the hooks.
 *
 * Returns the resolved path so the CLI can surface it.
 */
export function installMcpEntry(
  spec: HookSpec,
  serverName: string,
  serverEntry: McpServerEntry,
  options: InstallOptions = {},
): string {
  const paths = resolveInstallPaths(spec, options);
  if (spec.style === 'codex-array') {
    installCodexMcpToml(paths.mcpFile, serverName, serverEntry);
    // eslint-disable-next-line no-console
    console.log(`Registered MCP server '${serverName}' in ${paths.mcpFile}`);
    return paths.mcpFile;
  }
  const cfg = loadJson(paths.mcpFile);
  const servers = (cfg[paths.mcpKey] as Record<string, unknown>) ?? {};
  servers[serverName] = serverEntry as unknown as Record<string, unknown>;
  cfg[paths.mcpKey] = servers;
  saveJson(paths.mcpFile, cfg);
  // eslint-disable-next-line no-console
  console.log(`Registered MCP server '${serverName}' in ${paths.mcpFile}`);
  return paths.mcpFile;
}

/**
 * Removes an MCP server entry from the scope's mcpServers map.
 * Drops the surrounding map when it ends up empty.
 */
export function uninstallMcpEntry(
  spec: HookSpec,
  serverName: string,
  options: InstallOptions = {},
): string {
  const paths = resolveInstallPaths(spec, options);
  if (spec.style === 'codex-array') {
    const removed = uninstallCodexMcpToml(paths.mcpFile, serverName);
    // eslint-disable-next-line no-console
    console.log(
      removed
        ? `Removed MCP server '${serverName}' from ${paths.mcpFile}`
        : `No MCP server '${serverName}' in ${paths.mcpFile}. Nothing to remove.`,
    );
    return paths.mcpFile;
  }
  const cfg = loadJson(paths.mcpFile);
  const servers = cfg[paths.mcpKey] as Record<string, unknown> | undefined;
  if (!servers || servers[serverName] === undefined) {
    // eslint-disable-next-line no-console
    console.log(`No MCP server '${serverName}' in ${paths.mcpFile}. Nothing to remove.`);
    return paths.mcpFile;
  }
  delete servers[serverName];
  if (Object.keys(servers).length === 0) {
    delete cfg[paths.mcpKey];
  }
  saveJson(paths.mcpFile, cfg);
  // eslint-disable-next-line no-console
  console.log(`Removed MCP server '${serverName}' from ${paths.mcpFile}`);
  return paths.mcpFile;
}

function installCodexMcpToml(
  file: string,
  serverName: string,
  serverEntry: McpServerEntry,
): void {
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
  const stripped = removeTomlSection(before, `mcp_servers.${serverName}`);
  const block = [
    `[mcp_servers.${serverName}]`,
    `command = ${JSON.stringify(serverEntry.command)}`,
    ...(serverEntry.args ? [`args = ${tomlStringArray(serverEntry.args)}`] : []),
    '',
  ].join('\n');
  const next = [stripped.trimEnd(), block].filter(Boolean).join('\n\n');
  saveText(file, `${next.trimEnd()}\n`);
}

function uninstallCodexMcpToml(file: string, serverName: string): boolean {
  if (!fs.existsSync(file)) return false;
  const before = fs.readFileSync(file, 'utf-8');
  const after = removeTomlSection(before, `mcp_servers.${serverName}`);
  if (after === before) return false;
  saveText(file, after.trimEnd() ? `${after.trimEnd()}\n` : '');
  return true;
}

function removeTomlSection(text: string, sectionName: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let skipping = false;
  let removed = false;
  const header = `[${sectionName}]`;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === header) {
      skipping = true;
      removed = true;
      continue;
    }
    if (skipping && trimmed.startsWith('[') && trimmed.endsWith(']')) {
      skipping = false;
    }
    if (!skipping) out.push(line);
  }
  return removed ? out.join('\n').replace(/\n{3,}/g, '\n\n') : text;
}

function tomlStringArray(values: string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(', ')}]`;
}
