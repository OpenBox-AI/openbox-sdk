import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOOK_SPEC } from '../../core-client/generated/runtime/claude-code.js';
import {
  CLAUDE_CODE_GOVERNANCE_AUDIT,
  CLAUDE_CODE_HOOK_MATRIX,
  CLAUDE_CODE_SDK_CAPABILITY_MATRIX,
  CLAUDE_CODE_SURFACE_MATRIX,
  defaultClaudeCodeHookEvents,
  optInClaudeCodeHookEvents,
} from './governance-matrix.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EXPECTED_COMMAND_FILES = [
  'openbox-check.md',
  'openbox-doctor.md',
  'openbox-list-agents.md',
  'openbox-pending.md',
  'openbox-status.md',
] as const;
const EXPECTED_AGENT_FILES = ['openbox-reviewer.md'] as const;
const EXPECTED_DIAGNOSTIC_FILES = [
  'component-inventory.json',
  'claude-code-governance.json',
  'monitors.opt-in.json',
] as const;
const EXPECTED_BIN_FILES = ['openbox-cli.mjs', 'openbox-plugin-doctor'] as const;
const EXPECTED_COMPONENT_NAMES = [
  'skill',
  'commands',
  'agent',
  'hooks',
  'mcp',
  'diagnostics',
  'bin',
  'settings',
  'monitors',
  'lsp',
] as const;

const PLUGIN_CLI_RUNNER = 'bin/openbox-cli.mjs';
const PLUGIN_HOOK_HANDLER = {
  type: 'command',
  command: 'node',
  args: [`\${CLAUDE_PLUGIN_ROOT}/${PLUGIN_CLI_RUNNER}`, 'claude-code', 'hook'],
} as const;
const PLUGIN_MCP_SERVER = {
  command: 'node',
  args: [`\${CLAUDE_PLUGIN_ROOT}/${PLUGIN_CLI_RUNNER}`, 'mcp', 'serve'],
} as const;

export type ClaudeCodePluginScope = 'project';
export type ClaudeCodePluginCheckStatus = 'pass' | 'fail';

export interface ClaudeCodePluginCheck {
  name: string;
  status: ClaudeCodePluginCheckStatus;
  path?: string;
  detail?: string;
}

export interface ExportClaudeCodePluginOptions {
  /** Output directory for the complete plugin folder. */
  out: string;
  /** Remove an existing output directory first. Defaults to true. */
  force?: boolean;
  /** Optional per-event hook matchers copied into hooks/hooks.json. */
  matchers?: Record<string, string>;
  /** Include opt-in hook events such as SessionEnd. Defaults to false. */
  includeOptInHooks?: boolean;
}

export interface InstallClaudeCodePluginOptions {
  /** Project-only install scope. Defaults to project. */
  scope?: ClaudeCodePluginScope;
  /** Project root for project-scoped install. Defaults to process.cwd(). */
  cwd?: string;
  /** Project-local plugin target. Defaults to <cwd>/.claude/skills/openbox. */
  target?: string;
  /** Symlink this complete plugin folder instead of copying generated output. */
  symlink?: string;
  /** Optional per-event hook matchers copied into hooks/hooks.json. */
  matchers?: Record<string, string>;
  /** Include opt-in hook events such as SessionEnd. Defaults to false. */
  includeOptInHooks?: boolean;
  /** Skip creating the hook runtime config template. Defaults to false. */
  skipRuntimeConfig?: boolean;
}

export interface VerifyClaudeCodePluginOptions {
  scope?: ClaudeCodePluginScope;
  cwd?: string;
  target?: string;
  /** Validate a plugin that intentionally includes opt-in hooks. */
  includeOptInHooks?: boolean;
}

export interface UninstallClaudeCodePluginOptions {
  scope?: ClaudeCodePluginScope;
  cwd?: string;
  target?: string;
}

export function claudeCodePluginTargetDir(cwd = process.cwd()): string {
  return path.join(cwd, '.claude', 'skills', 'openbox');
}

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function packageVersion(): string {
  const candidates = [
    path.resolve(__dirname, '../../package.json'),
    path.resolve(__dirname, '../../../package.json'),
    path.resolve(__dirname, '../../../../package.json'),
    path.resolve(process.cwd(), 'package.json'),
  ];
  for (const candidate of candidates) {
    const pkg = readJson(candidate);
    if (typeof pkg?.version === 'string' && pkg.version.length > 0) {
      return pkg.version;
    }
  }
  return '0.1.0';
}

function findExistingDir(label: string, candidates: string[]): string {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Could not find ${label} in any of:\n${candidates.map((c) => `  - ${c}`).join('\n')}`,
  );
}

function findTemplateDir(kind: 'commands' | 'agents'): string {
  return findExistingDir(`Claude Code template directory '${kind}'`, [
    path.resolve(__dirname, 'templates', kind),
    path.resolve(__dirname, '../runtime/claude-code/templates', kind),
    path.resolve(__dirname, '../../ts/src/runtime/claude-code/templates', kind),
    path.resolve(__dirname, '../../../ts/src/runtime/claude-code/templates', kind),
    path.resolve(process.cwd(), 'ts/src/runtime/claude-code/templates', kind),
  ]);
}

function findSkillDir(): string {
  return findExistingDir('OpenBox skill directory', [
    path.resolve(__dirname, '../../skill'),
    path.resolve(__dirname, '../../../skill'),
    path.resolve(__dirname, '../../../../skill'),
    path.resolve(process.cwd(), 'skill'),
  ]);
}

function safeOutDir(out: string): string {
  const resolved = path.resolve(out);
  const root = path.parse(resolved).root;
  if (resolved === root || resolved === os.homedir()) {
    throw new Error(`Refusing to overwrite unsafe Claude Code plugin path: ${resolved}`);
  }
  return resolved;
}

function assertProjectTarget(target: string, cwd: string): string {
  const resolvedTarget = safeOutDir(target);
  const resolvedProject = path.resolve(cwd);
  const rel = path.relative(resolvedProject, resolvedTarget);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Claude Code plugin install target must be inside the project: ${resolvedProject}`);
  }
  return resolvedTarget;
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf-8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isLegacyClaudeCodeHook(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.command === 'string' &&
    /\bopenbox\s+claude-code\s+hook\b/.test(value.command)
  );
}

function scrubLegacyClaudeCodeSettingsHooks(cwd: string): void {
  const settingsFile = path.join(cwd, '.claude', 'settings.json');
  const settings = readJson(settingsFile);
  if (!settings || !isRecord(settings.hooks)) return;

  let changed = false;
  const nextHooks: Record<string, unknown> = {};
  for (const [eventName, entries] of Object.entries(settings.hooks)) {
    if (!Array.isArray(entries)) {
      nextHooks[eventName] = entries;
      continue;
    }
    const nextEntries = entries
      .map((entry) => {
        if (!isRecord(entry)) return entry;
        if (isLegacyClaudeCodeHook(entry)) {
          changed = true;
          return undefined;
        }
        if (!Array.isArray(entry.hooks)) return entry;
        const nextInnerHooks = entry.hooks.filter((hook) => !isLegacyClaudeCodeHook(hook));
        if (nextInnerHooks.length !== entry.hooks.length) changed = true;
        if (nextInnerHooks.length === 0) return undefined;
        return { ...entry, hooks: nextInnerHooks };
      })
      .filter((entry) => entry !== undefined);
    if (nextEntries.length === 0) {
      changed = true;
      continue;
    }
    nextHooks[eventName] = nextEntries;
  }

  if (!changed) return;
  const nextSettings = { ...settings };
  if (Object.keys(nextHooks).length > 0) {
    nextSettings.hooks = nextHooks;
  } else {
    delete nextSettings.hooks;
  }
  if (Object.keys(nextSettings).length === 0) {
    rmSync(settingsFile, { force: true });
    return;
  }
  writeJson(settingsFile, nextSettings);
}

function hasLegacyClaudeCodeSettingsHooks(cwd = process.cwd()): boolean {
  const settings = readJson(path.join(cwd, '.claude', 'settings.json'));
  return JSON.stringify(settings ?? {}).includes('openbox claude-code hook');
}

function isLegacyOpenBoxMcpServer(value: unknown): boolean {
  if (!isRecord(value) || value.command !== 'openbox') return false;
  const args = Array.isArray(value.args) ? value.args : [];
  return args[0] === 'mcp' && args[1] === 'serve';
}

function scrubLegacyOpenBoxProjectMcp(cwd: string): void {
  const mcpFile = path.join(cwd, '.mcp.json');
  const mcp = readJson(mcpFile);
  if (!mcp || !isRecord(mcp.mcpServers)) return;
  if (!isLegacyOpenBoxMcpServer(mcp.mcpServers.openbox)) return;

  const nextServers = { ...mcp.mcpServers };
  delete nextServers.openbox;
  const nextMcp = { ...mcp };
  if (Object.keys(nextServers).length > 0) {
    nextMcp.mcpServers = nextServers;
  } else {
    delete nextMcp.mcpServers;
  }
  if (Object.keys(nextMcp).length === 0) {
    rmSync(mcpFile, { force: true });
    return;
  }
  writeJson(mcpFile, nextMcp);
}

function hasLegacyOpenBoxProjectMcp(cwd = process.cwd()): boolean {
  const mcp = readJson(path.join(cwd, '.mcp.json'));
  return isLegacyOpenBoxMcpServer(
    isRecord(mcp?.mcpServers) ? mcp.mcpServers.openbox : undefined,
  );
}

function writeRuntimeConfigTemplate(configDir: string): void {
  mkdirSync(configDir, { recursive: true });
  const file = path.join(configDir, 'config.json');
  if (existsSync(file)) return;
  const example = {
    OPENBOX_API_KEY: 'obx_live_YOUR_API_KEY_HERE',
    OPENBOX_CORE_URL: 'https://core.example/ob',
    GOVERNANCE_POLICY: 'fail_open',
    HITL_ENABLED: true,
    HITL_MAX_WAIT: 300,
    VERBOSE: false,
    DRY_RUN: true,
  };
  writeFileSync(file, JSON.stringify(example, null, 2) + '\n', {
    mode: 0o600,
    encoding: 'utf-8',
  });
}

export function claudeCodeRuntimeConfigDir(
  cwd = process.cwd(),
): string {
  return path.join(cwd, '.claude-hooks');
}

function hookEvents(includeOptInHooks = false): typeof HOOK_SPEC.events {
  const defaultEvents = new Set(defaultClaudeCodeHookEvents());
  return HOOK_SPEC.events.filter((event) => {
    if (event.installDefault === false) return includeOptInHooks;
    if (!defaultEvents.has(event.name)) return includeOptInHooks;
    return true;
  });
}

function claudeHooksJson(matchers?: Record<string, string>, includeOptInHooks = false): Record<string, unknown> {
  const hooks: Record<string, Array<Record<string, unknown>>> = {};
  for (const event of hookEvents(includeOptInHooks)) {
    const hook: Record<string, unknown> = {
      ...PLUGIN_HOOK_HANDLER,
    };
    if (event.timeout !== undefined) hook.timeout = event.timeout;
    const entry: Record<string, unknown> = {
      hooks: [hook],
    };
    const matcher = matchers?.[event.name];
    if (matcher) entry.matcher = matcher;
    hooks[event.name] = [entry];
  }
  return { [HOOK_SPEC.key]: hooks };
}

function mcpJson(): Record<string, unknown> {
  return {
    mcpServers: {
      openbox: { ...PLUGIN_MCP_SERVER },
    },
  };
}

function componentInventory(version: string): Record<string, unknown> {
  const defaultEvents = hookEvents(false).map((event) => event.name);
  return {
    name: 'openbox',
    version,
    capturedAt: CLAUDE_CODE_GOVERNANCE_AUDIT.capturedAt,
    installedClaudeCodeVersion: CLAUDE_CODE_GOVERNANCE_AUDIT.installedClaudeCodeVersion,
    components: {
      skill: {
        status: 'installed',
        path: 'skills/openbox/SKILL.md',
      },
      commands: {
        status: 'installed',
        path: 'commands/',
        files: [...EXPECTED_COMMAND_FILES],
      },
      agent: {
        status: 'installed',
        path: 'agents/openbox-reviewer.md',
      },
      hooks: {
        status: 'installed',
        path: 'hooks/hooks.json',
        defaultEvents,
        optInEvents: optInClaudeCodeHookEvents(),
      },
      mcp: {
        status: 'installed',
        path: '.mcp.json',
        command: 'node ${CLAUDE_PLUGIN_ROOT}/bin/openbox-cli.mjs mcp serve',
      },
      settings: {
        status: 'diagnose_only',
        path: 'settings.json',
        emitted: false,
        notes: 'OpenBox does not emit plugin settings; agent/subagentStatusLine and strictPluginOnlyCustomization remain deployment policy diagnostics.',
      },
      diagnostics: {
        status: 'installed',
        path: 'diagnostics/',
        files: [...EXPECTED_DIAGNOSTIC_FILES],
      },
      bin: {
        status: 'installed',
        path: 'bin/openbox-plugin-doctor',
        files: [...EXPECTED_BIN_FILES],
        command: 'node ${CLAUDE_PLUGIN_ROOT}/bin/openbox-cli.mjs claude-code doctor',
      },
      monitors: {
        status: 'opt_in_metadata',
        activeByDefault: false,
        path: 'diagnostics/monitors.opt-in.json',
        notes: 'Copy to monitors/monitors.json only after accepting unsandboxed monitor execution.',
      },
      lsp: {
        status: 'not_included',
        notes: 'No OpenBox language-server use case was found in the Claude Code governance audit.',
      },
    },
    surfaces: CLAUDE_CODE_SURFACE_MATRIX,
  };
}

function governanceDiagnostic(version: string): Record<string, unknown> {
  return {
    version,
    audit: CLAUDE_CODE_GOVERNANCE_AUDIT,
    hooks: CLAUDE_CODE_HOOK_MATRIX,
    defaultHookEvents: defaultClaudeCodeHookEvents(),
    optInHookEvents: optInClaudeCodeHookEvents(),
    generatedHookSpecEvents: HOOK_SPEC.events.map((event) => event.name),
    surfaces: CLAUDE_CODE_SURFACE_MATRIX,
    sdkCapabilities: CLAUDE_CODE_SDK_CAPABILITY_MATRIX,
  };
}

function optInMonitorMetadata(): Array<Record<string, unknown>> {
  return [
    {
      name: 'openbox-status',
      command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/openbox-cli.mjs" status --json',
      description: 'OpenBox runtime status and approval readiness notifications.',
      when: 'on-skill-invoke:openbox',
      activeByDefault: false,
    },
  ];
}

function writePluginCliRunner(file: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    [
      '#!/usr/bin/env node',
      "import { existsSync } from 'node:fs';",
      "import path from 'node:path';",
      "import { spawnSync } from 'node:child_process';",
      '',
      'const args = process.argv.slice(2);',
      '',
      'function candidateFromEnv() {',
      '  const value = process.env.OPENBOX_CLI;',
      '  if (!value) return undefined;',
      '  const resolved = path.resolve(value);',
      '  return existsSync(resolved) ? resolved : undefined;',
      '}',
      '',
      'function projectRoots() {',
      '  const roots = [];',
      '  if (process.env.CLAUDE_PROJECT_DIR) roots.push(process.env.CLAUDE_PROJECT_DIR);',
      '  roots.push(process.cwd());',
      '  const out = [];',
      '  for (const root of roots) {',
      '    let cur = path.resolve(root);',
      '    for (let i = 0; i < 8; i += 1) {',
      '      if (!out.includes(cur)) out.push(cur);',
      '      const parent = path.dirname(cur);',
      '      if (parent === cur) break;',
      '      cur = parent;',
      '    }',
      '  }',
      '  return out;',
      '}',
      '',
      'function candidateFromProjectNodeModules() {',
      '  for (const root of projectRoots()) {',
      "    const candidate = path.join(root, 'node_modules', '@openbox-ai', 'openbox-sdk', 'dist', 'cli', 'index.js');",
      '    if (existsSync(candidate)) return candidate;',
      '  }',
      '  return undefined;',
      '}',
      '',
      'const cli = candidateFromEnv() ?? candidateFromProjectNodeModules();',
      'if (!cli) {',
      "  console.error('OpenBox SDK CLI not found for project-scoped Claude Code plugin. Set OPENBOX_CLI to this project\\'s SDK dist/cli/index.js, or install @openbox-ai/openbox-sdk in the project.');",
      '  process.exit(127);',
      '}',
      '',
      'const result = spawnSync(process.execPath, [cli, ...args], {',
      "  stdio: 'inherit',",
      '  env: process.env,',
      '});',
      '',
      'if (result.error) {',
      '  console.error(result.error.message);',
      '  process.exit(127);',
      '}',
      'process.exit(result.status ?? 1);',
      '',
    ].join('\n'),
    'utf-8',
  );
  chmodSync(file, 0o755);
}

function writePluginDoctorShim(file: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    [
      '#!/usr/bin/env sh',
      'set -eu',
      'DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"',
      'exec node "$DIR/openbox-cli.mjs" claude-code doctor "$@"',
      '',
    ].join('\n'),
    'utf-8',
  );
  chmodSync(file, 0o755);
}

function pluginManifest(version: string): Record<string, unknown> {
  return {
    name: 'openbox',
    displayName: 'OpenBox AI Governance',
    version,
    description:
      'Active governance for Claude Code: prompt gates, tool gates, policy checks, guardrails, approvals, MCP tools, skills, and agent templates.',
    author: {
      name: 'OpenBox AI',
      email: 'team@openbox.ai',
    },
    license: 'MIT',
    homepage: 'https://github.com/OpenBox-AI/openbox-sdk#readme',
    repository: 'https://github.com/OpenBox-AI/openbox-sdk',
    keywords: [
      'openbox',
      'ai-governance',
      'claude-code',
      'guardrails',
      'policy',
      'opa',
      'approvals',
      'hitl',
      'agent-trace',
      'behavior-rules',
      'skill',
      'mcp',
      'hooks',
      'agents',
      'commands',
    ],
  };
}

function marketplaceManifest(version: string): Record<string, unknown> {
  return {
    name: 'openbox',
    description:
      'OpenBox governance plugin marketplace for Claude Code.',
    owner: {
      name: 'OpenBox AI',
      email: 'team@openbox.ai',
    },
    plugins: [
      {
        name: 'openbox',
        source: './',
        description:
          'Active governance for Claude Code through prompt/tool hooks, OpenBox Core verdicts, approvals, MCP tools, skills, and agent templates.',
        version,
        author: {
          name: 'OpenBox AI',
          email: 'team@openbox.ai',
        },
        homepage: 'https://github.com/OpenBox-AI/openbox-sdk#readme',
        repository: 'https://github.com/OpenBox-AI/openbox-sdk',
        license: 'MIT',
        keywords: ['openbox', 'claude-code', 'ai-governance', 'guardrails', 'approvals'],
      },
    ],
  };
}

function copyDir(src: string, dst: string): void {
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(path.dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: true });
}

export function exportClaudeCodePlugin(options: ExportClaudeCodePluginOptions): string {
  const out = safeOutDir(options.out);
  if (existsSync(out)) {
    if (options.force === false) {
      throw new Error(`Claude Code plugin output already exists: ${out}`);
    }
    rmSync(out, { recursive: true, force: true });
  }
  mkdirSync(out, { recursive: true });

  const version = packageVersion();
  writeJson(path.join(out, '.claude-plugin', 'plugin.json'), pluginManifest(version));
  writeJson(path.join(out, '.claude-plugin', 'marketplace.json'), marketplaceManifest(version));
  copyDir(findSkillDir(), path.join(out, 'skills', 'openbox'));
  copyDir(findTemplateDir('commands'), path.join(out, 'commands'));
  copyDir(findTemplateDir('agents'), path.join(out, 'agents'));
  writeJson(path.join(out, 'hooks', 'hooks.json'), claudeHooksJson(options.matchers, options.includeOptInHooks));
  writeJson(path.join(out, '.mcp.json'), mcpJson());
  writeJson(path.join(out, 'diagnostics', 'component-inventory.json'), componentInventory(version));
  writeJson(path.join(out, 'diagnostics', 'claude-code-governance.json'), governanceDiagnostic(version));
  writeJson(path.join(out, 'diagnostics', 'monitors.opt-in.json'), optInMonitorMetadata());
  writePluginCliRunner(path.join(out, PLUGIN_CLI_RUNNER));
  writePluginDoctorShim(path.join(out, 'bin', 'openbox-plugin-doctor'));

  return out;
}

export function installClaudeCodePlugin(options: InstallClaudeCodePluginOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const target = assertProjectTarget(options.target ?? claudeCodePluginTargetDir(cwd), cwd);
  if (options.symlink) {
    const source = safeOutDir(options.symlink);
    if (!existsSync(source)) {
      throw new Error(`Claude Code plugin symlink source does not exist: ${source}`);
    }
    rmSync(target, { recursive: true, force: true });
    mkdirSync(path.dirname(target), { recursive: true });
    symlinkSync(source, target, 'dir');
    if (!options.skipRuntimeConfig) {
      writeRuntimeConfigTemplate(claudeCodeRuntimeConfigDir(cwd));
    }
    scrubLegacyClaudeCodeSettingsHooks(cwd);
    scrubLegacyOpenBoxProjectMcp(cwd);
    return target;
  }
  const out = exportClaudeCodePlugin({
    out: target,
    matchers: options.matchers,
    includeOptInHooks: options.includeOptInHooks,
  });
  if (!options.skipRuntimeConfig) {
    writeRuntimeConfigTemplate(claudeCodeRuntimeConfigDir(cwd));
  }
  scrubLegacyClaudeCodeSettingsHooks(cwd);
  scrubLegacyOpenBoxProjectMcp(cwd);
  return out;
}

export function uninstallClaudeCodePlugin(options: UninstallClaudeCodePluginOptions = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const target = assertProjectTarget(options.target ?? claudeCodePluginTargetDir(cwd), cwd);
  rmSync(target, { recursive: true, force: true });
  scrubLegacyClaudeCodeSettingsHooks(cwd);
  scrubLegacyOpenBoxProjectMcp(cwd);
}

function checkFile(name: string, file: string): ClaudeCodePluginCheck {
  return {
    name,
    status: existsSync(file) ? 'pass' : 'fail',
    path: file,
    detail: existsSync(file) ? 'present' : 'missing',
  };
}

function checkDirFiles(name: string, dir: string, expected: readonly string[]): ClaudeCodePluginCheck {
  if (!existsSync(dir)) {
    return { name, status: 'fail', path: dir, detail: 'directory missing' };
  }
  const present = new Set(readdirSync(dir).filter((file) => expected.includes(file)));
  const missing = expected.filter((file) => !present.has(file));
  return {
    name,
    status: missing.length === 0 ? 'pass' : 'fail',
    path: dir,
    detail: missing.length === 0 ? `${expected.length} file(s)` : `missing: ${missing.join(', ')}`,
  };
}

function checkHooks(file: string, includeOptInHooks = false): ClaudeCodePluginCheck {
  const hooksJson = readJson(file);
  const hooks = hooksJson?.[HOOK_SPEC.key] as Record<string, unknown> | undefined;
  const problems: string[] = [];
  if (!hooks || typeof hooks !== 'object') {
    problems.push('hooks block missing');
  } else {
    for (const event of hookEvents(includeOptInHooks)) {
      const value = hooks[event.name];
      if (!Array.isArray(value) || value.length === 0) {
        problems.push(`${event.name}: missing array entry`);
        continue;
      }
      const entry = value[0] as { hooks?: unknown; matcher?: unknown };
      const hook = Array.isArray(entry.hooks)
        ? entry.hooks[0] as { args?: unknown; command?: unknown; type?: unknown; timeout?: unknown } | undefined
        : undefined;
      if (hook?.type !== 'command') {
        problems.push(`${event.name}: hook type drift`);
      }
      if (hook?.command !== PLUGIN_HOOK_HANDLER.command) {
        problems.push(`${event.name}: command drift`);
      }
      if (JSON.stringify(hook?.args) !== JSON.stringify(PLUGIN_HOOK_HANDLER.args)) {
        problems.push(`${event.name}: args drift`);
      }
      if (event.timeout !== undefined && hook?.timeout !== event.timeout) {
        problems.push(`${event.name}: timeout ${String(hook?.timeout)} != ${event.timeout}`);
      }
    }
    for (const entry of CLAUDE_CODE_HOOK_MATRIX.filter((item) => item.defaultInstall && item.status !== 'explicit_out_of_scope')) {
      if (!hooks[entry.event]) {
        problems.push(`${entry.event}: missing from default governance matrix`);
      }
    }
    for (const entry of CLAUDE_CODE_HOOK_MATRIX.filter((item) => !item.defaultInstall)) {
      if (!includeOptInHooks && hooks[entry.event]) {
        problems.push(`${entry.event}: opt-in event installed by default`);
      }
    }
  }
  return {
    name: 'plugin-hooks',
    status: problems.length === 0 ? 'pass' : 'fail',
    path: file,
    detail: problems.length === 0 ? `${hookEvents(includeOptInHooks).length} event(s)` : problems.join('; '),
  };
}

function checkMcp(file: string): ClaudeCodePluginCheck {
  const json = readJson(file);
  const openbox = (json?.mcpServers as Record<string, unknown> | undefined)?.openbox as
    | { command?: unknown; args?: unknown }
    | undefined;
  const ok =
    openbox?.command === PLUGIN_MCP_SERVER.command &&
    Array.isArray(openbox.args) &&
    JSON.stringify(openbox.args) === JSON.stringify(PLUGIN_MCP_SERVER.args);
  return {
    name: 'plugin-mcp',
    status: ok ? 'pass' : 'fail',
    path: file,
    detail: ok ? 'node bin/openbox-cli.mjs mcp serve' : 'openbox server entry missing or malformed',
  };
}

function checkComponentInventory(file: string): ClaudeCodePluginCheck {
  const json = readJson(file);
  const components = json?.components as Record<string, unknown> | undefined;
  const missing = EXPECTED_COMPONENT_NAMES.filter((name) => !components?.[name]);
  return {
    name: 'plugin-component-inventory',
    status: missing.length === 0 ? 'pass' : 'fail',
    path: file,
    detail: missing.length === 0
      ? `${EXPECTED_COMPONENT_NAMES.length} component(s)`
      : `missing: ${missing.join(', ')}`,
  };
}

function checkNoLegacySettingsHooks(cwd = process.cwd()): ClaudeCodePluginCheck {
  const file = path.join(cwd, '.claude', 'settings.json');
  const stale = hasLegacyClaudeCodeSettingsHooks(cwd);
  return {
    name: 'project-settings-legacy-hooks',
    status: stale ? 'fail' : 'pass',
    path: file,
    detail: stale
      ? 'remove stale `openbox claude-code hook` project settings entries'
      : 'no legacy project settings hooks',
  };
}

function checkNoLegacyProjectMcp(cwd = process.cwd()): ClaudeCodePluginCheck {
  const file = path.join(cwd, '.mcp.json');
  const stale = hasLegacyOpenBoxProjectMcp(cwd);
  return {
    name: 'project-mcp-legacy-openbox',
    status: stale ? 'fail' : 'pass',
    path: file,
    detail: stale
      ? 'remove stale project `.mcp.json` openbox command entry'
      : 'no legacy project MCP openbox entry',
  };
}

export function verifyClaudeCodePlugin(
  options: VerifyClaudeCodePluginOptions = {},
): ClaudeCodePluginCheck[] {
  const target = safeOutDir(
    options.target ?? claudeCodePluginTargetDir(options.cwd),
  );
  const checks: ClaudeCodePluginCheck[] = [];
  if (existsSync(target)) {
    const stat = lstatSync(target);
    checks.push({
      name: 'plugin',
      status: 'pass',
      path: target,
      detail: stat.isSymbolicLink() ? 'symlink installed' : 'installed',
    });
  } else {
    checks.push({ name: 'plugin', status: 'fail', path: target, detail: 'missing' });
  }
  checks.push(checkFile('plugin-manifest', path.join(target, '.claude-plugin', 'plugin.json')));
  checks.push(checkFile('plugin-marketplace', path.join(target, '.claude-plugin', 'marketplace.json')));
  checks.push(checkFile('plugin-skill', path.join(target, 'skills', 'openbox', 'SKILL.md')));
  checks.push(checkDirFiles('plugin-commands', path.join(target, 'commands'), EXPECTED_COMMAND_FILES));
  checks.push(checkDirFiles('plugin-agents', path.join(target, 'agents'), EXPECTED_AGENT_FILES));
  checks.push(checkHooks(path.join(target, 'hooks', 'hooks.json'), options.includeOptInHooks));
  checks.push(checkMcp(path.join(target, '.mcp.json')));
  checks.push(checkDirFiles('plugin-diagnostics', path.join(target, 'diagnostics'), EXPECTED_DIAGNOSTIC_FILES));
  checks.push(checkComponentInventory(path.join(target, 'diagnostics', 'component-inventory.json')));
  checks.push(checkDirFiles('plugin-bin', path.join(target, 'bin'), EXPECTED_BIN_FILES));
  checks.push(checkNoLegacySettingsHooks(options.cwd));
  checks.push(checkNoLegacyProjectMcp(options.cwd));
  return checks;
}
