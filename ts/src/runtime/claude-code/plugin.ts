import {
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EXPECTED_COMMAND_FILES = [
  'openbox-check.md',
  'openbox-doctor.md',
  'openbox-list-agents.md',
  'openbox-pending.md',
  'openbox-status.md',
] as const;
const EXPECTED_AGENT_FILES = ['openbox-reviewer.md'] as const;

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
  /** Skip creating the hook runtime config template. Defaults to false. */
  skipRuntimeConfig?: boolean;
}

export interface VerifyClaudeCodePluginOptions {
  scope?: ClaudeCodePluginScope;
  cwd?: string;
  target?: string;
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

function claudeHooksJson(matchers?: Record<string, string>): Record<string, unknown> {
  const hooks: Record<string, Array<Record<string, unknown>>> = {};
  for (const event of HOOK_SPEC.events) {
    const hook: Record<string, unknown> = {
      type: 'command',
      command: HOOK_SPEC.command,
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
      openbox: {
        command: 'openbox',
        args: ['mcp', 'serve'],
      },
    },
  };
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
  writeJson(path.join(out, 'hooks', 'hooks.json'), claudeHooksJson(options.matchers));
  writeJson(path.join(out, '.mcp.json'), mcpJson());

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
    return target;
  }
  const out = exportClaudeCodePlugin({
    out: target,
    matchers: options.matchers,
  });
  if (!options.skipRuntimeConfig) {
    writeRuntimeConfigTemplate(claudeCodeRuntimeConfigDir(cwd));
  }
  return out;
}

export function uninstallClaudeCodePlugin(options: UninstallClaudeCodePluginOptions = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const target = assertProjectTarget(options.target ?? claudeCodePluginTargetDir(cwd), cwd);
  rmSync(target, { recursive: true, force: true });
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

function checkHooks(file: string): ClaudeCodePluginCheck {
  const hooksJson = readJson(file);
  const hooks = hooksJson?.[HOOK_SPEC.key] as Record<string, unknown> | undefined;
  const problems: string[] = [];
  if (!hooks || typeof hooks !== 'object') {
    problems.push('hooks block missing');
  } else {
    for (const event of HOOK_SPEC.events) {
      const value = hooks[event.name];
      if (!Array.isArray(value) || value.length === 0) {
        problems.push(`${event.name}: missing array entry`);
        continue;
      }
      const entry = value[0] as { hooks?: unknown; matcher?: unknown };
      const hook = Array.isArray(entry.hooks)
        ? entry.hooks[0] as { command?: unknown; type?: unknown; timeout?: unknown } | undefined
        : undefined;
      if (hook?.type !== 'command') {
        problems.push(`${event.name}: hook type drift`);
      }
      if (hook?.command !== HOOK_SPEC.command) {
        problems.push(`${event.name}: command drift`);
      }
      if (event.timeout !== undefined && hook?.timeout !== event.timeout) {
        problems.push(`${event.name}: timeout ${String(hook?.timeout)} != ${event.timeout}`);
      }
    }
  }
  return {
    name: 'plugin-hooks',
    status: problems.length === 0 ? 'pass' : 'fail',
    path: file,
    detail: problems.length === 0 ? `${HOOK_SPEC.events.length} event(s)` : problems.join('; '),
  };
}

function checkMcp(file: string): ClaudeCodePluginCheck {
  const json = readJson(file);
  const openbox = (json?.mcpServers as Record<string, unknown> | undefined)?.openbox as
    | { command?: unknown; args?: unknown }
    | undefined;
  const ok =
    openbox?.command === 'openbox' &&
    Array.isArray(openbox.args) &&
    openbox.args[0] === 'mcp' &&
    openbox.args[1] === 'serve';
  return {
    name: 'plugin-mcp',
    status: ok ? 'pass' : 'fail',
    path: file,
    detail: ok ? 'openbox mcp serve' : 'openbox server entry missing or malformed',
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
  checks.push(checkHooks(path.join(target, 'hooks', 'hooks.json')));
  checks.push(checkMcp(path.join(target, '.mcp.json')));
  return checks;
}
