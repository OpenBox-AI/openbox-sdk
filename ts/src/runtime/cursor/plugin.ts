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
import { HOOK_SPEC } from '../../core-client/generated/runtime/cursor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EXPECTED_COMMAND_FILES = [
  'openbox-check.md',
  'openbox-doctor.md',
  'openbox-list-agents.md',
  'openbox-pending.md',
  'openbox-status.md',
] as const;
const EXPECTED_RULE_FILES = ['openbox.mdc'] as const;
const EXPECTED_AGENT_FILES = ['openbox-reviewer.md'] as const;
const EXPECTED_REPO_RULE_FILES = ['openbox-governance.mdc'] as const;

export type CursorPluginCheckStatus = 'pass' | 'fail' | 'skip';

export interface CursorPluginCheck {
  name: string;
  status: CursorPluginCheckStatus;
  path?: string;
  detail?: string;
}

export interface ExportCursorPluginOptions {
  /** Output directory for the complete plugin folder. */
  out: string;
  /** Remove an existing output directory first. Defaults to true. */
  force?: boolean;
  /** Optional per-event hook matchers copied into hooks/hooks.json. */
  matchers?: Record<string, string>;
}

export interface InstallCursorPluginOptions {
  /** Project root for project-scoped install. Defaults to process.cwd(). */
  cwd?: string;
  /** Cursor project-local plugin target. Defaults to <cwd>/.cursor/plugins/local/openbox. */
  target?: string;
  /** Symlink this complete plugin folder instead of copying generated output. */
  symlink?: string;
  /** Optional per-event hook matchers copied into hooks/hooks.json. */
  matchers?: Record<string, string>;
  /** Skip creating the hook runtime config template. Defaults to false. */
  skipRuntimeConfig?: boolean;
}

export interface VerifyCursorPluginOptions {
  /** Project root for project-scoped install. Defaults to process.cwd(). */
  cwd?: string;
  /** Cursor project-local plugin target. Defaults to <cwd>/.cursor/plugins/local/openbox. */
  target?: string;
}

export interface InstallCursorRepoOptions {
  /** Project root for repo-scoped install. Defaults to process.cwd(). */
  cwd?: string;
  /** Optional per-event hook matchers copied into .cursor/hooks.json. */
  matchers?: Record<string, string>;
  /** Skip creating the hook runtime config template. Defaults to false. */
  skipRuntimeConfig?: boolean;
}

export interface VerifyCursorRepoOptions {
  cwd?: string;
}

export interface UninstallCursorRepoOptions {
  cwd?: string;
  removeSkill?: boolean;
}

export interface UninstallCursorPluginOptions {
  /** Project root for project-scoped install. Defaults to process.cwd(). */
  cwd?: string;
  /** Cursor project-local plugin target. Defaults to <cwd>/.cursor/plugins/local/openbox. */
  target?: string;
}

export function cursorPluginTargetDir(cwd = process.cwd()): string {
  return path.join(cwd, '.cursor', 'plugins', 'local', 'openbox');
}

export function cursorRuntimeConfigDir(cwd = process.cwd()): string {
  return path.join(cwd, '.cursor-hooks');
}

export function cursorRepoSkillTargetDir(cwd = process.cwd()): string {
  return path.join(cwd, '.agents', 'skills', 'openbox');
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

function findTemplateDir(kind: 'commands' | 'rules' | 'agents'): string {
  return findExistingDir(`Cursor template directory '${kind}'`, [
    path.resolve(__dirname, 'templates', kind),
    path.resolve(__dirname, '../runtime/cursor/templates', kind),
    path.resolve(__dirname, '../../ts/src/runtime/cursor/templates', kind),
    path.resolve(__dirname, '../../../ts/src/runtime/cursor/templates', kind),
    path.resolve(process.cwd(), 'ts/src/runtime/cursor/templates', kind),
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
    throw new Error(`Refusing to overwrite unsafe plugin output path: ${resolved}`);
  }
  return resolved;
}

function assertProjectTarget(target: string, cwd: string): string {
  const resolvedTarget = safeOutDir(target);
  const resolvedProject = path.resolve(cwd);
  const rel = path.relative(resolvedProject, resolvedTarget);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Cursor plugin install target must be inside the project: ${resolvedProject}`);
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
    hitlEnabled: true,
    hitlMaxWait: 300,
    verbose: false,
  };
  writeFileSync(file, JSON.stringify(example, null, 2) + '\n', {
    mode: 0o600,
    encoding: 'utf-8',
  });
}

function cursorHooksJson(matchers?: Record<string, string>): Record<string, unknown> {
  const hooks: Record<string, Array<Record<string, unknown>>> = {};
  for (const event of HOOK_SPEC.events) {
    const entry: Record<string, unknown> = { command: HOOK_SPEC.command };
    if (event.timeout !== undefined) entry.timeout = event.timeout;
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
      'Active governance for AI coding agents in Cursor: policy gates, guardrails, approvals, MCP, slash commands, rules, and agent templates.',
    author: {
      name: 'OpenBox AI',
      email: 'team@openbox.ai',
    },
    license: 'MIT',
    keywords: [
      'openbox',
      'ai-governance',
      'guardrails',
      'policy',
      'opa',
      'approvals',
      'hitl',
      'agent-trace',
      'behavior-rules',
      'cursor',
      'skill',
      'mcp',
      'rules',
      'agents',
      'commands',
    ],
  };
}

function marketplaceManifest(version: string): Record<string, unknown> {
  return {
    name: 'openbox',
    owner: {
      name: 'OpenBox AI',
      email: 'team@openbox.ai',
    },
    metadata: {
      description:
        'OpenBox governance bundle for Cursor: gates, approvals, slash commands, MCP server, rules, agent templates, and the OpenBox skill.',
      version,
    },
    plugins: [
      {
        name: 'openbox',
        source: '.',
        description:
          'Active governance for AI coding agents through pre-action gates, approval UI, agent-trace emission, slash commands, rules, and the OpenBox skill.',
      },
    ],
  };
}

function workspaceOpenManifest(): Record<string, unknown> {
  return {
    workspaceOpen: {
      plugins: [
        {
          name: 'openbox',
          path: '.cursor/plugins/local/openbox',
          activation: 'workspaceOpen',
        },
      ],
    },
  };
}

function copyDir(src: string, dst: string): void {
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(path.dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: true });
}

export function exportCursorPlugin(options: ExportCursorPluginOptions): string {
  const out = safeOutDir(options.out);
  if (existsSync(out)) {
    if (options.force === false) {
      throw new Error(`Cursor plugin output already exists: ${out}`);
    }
    rmSync(out, { recursive: true, force: true });
  }
  mkdirSync(out, { recursive: true });

  const version = packageVersion();
  writeJson(path.join(out, '.cursor-plugin', 'plugin.json'), pluginManifest(version));
  writeJson(path.join(out, '.cursor-plugin', 'marketplace.json'), marketplaceManifest(version));
  copyDir(findSkillDir(), path.join(out, 'skills', 'openbox'));
  copyDir(findTemplateDir('commands'), path.join(out, 'commands'));
  copyDir(findTemplateDir('rules'), path.join(out, 'rules'));
  copyDir(findTemplateDir('agents'), path.join(out, 'agents'));
  writeJson(path.join(out, 'hooks', 'hooks.json'), cursorHooksJson(options.matchers));
  writeJson(path.join(out, 'mcp.json'), mcpJson());
  writeJson(path.join(out, 'workspaceOpen.json'), workspaceOpenManifest());

  return out;
}

export function installCursorPlugin(options: InstallCursorPluginOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const target = assertProjectTarget(options.target ?? cursorPluginTargetDir(cwd), cwd);
  if (options.symlink) {
    const source = safeOutDir(options.symlink);
    if (!existsSync(source)) {
      throw new Error(`Cursor plugin symlink source does not exist: ${source}`);
    }
    rmSync(target, { recursive: true, force: true });
    mkdirSync(path.dirname(target), { recursive: true });
    symlinkSync(source, target, 'dir');
    if (!options.skipRuntimeConfig) {
      writeRuntimeConfigTemplate(cursorRuntimeConfigDir(cwd));
    }
    return target;
  }
  const out = exportCursorPlugin({
    out: target,
    matchers: options.matchers,
  });
  if (!options.skipRuntimeConfig) {
    writeRuntimeConfigTemplate(cursorRuntimeConfigDir(cwd));
  }
  return out;
}

export function uninstallCursorPlugin(options: UninstallCursorPluginOptions = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const target = assertProjectTarget(options.target ?? cursorPluginTargetDir(cwd), cwd);
  rmSync(target, { recursive: true, force: true });
}

export function installCursorRepoMode(options: InstallCursorRepoOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  writeJson(path.join(cwd, '.cursor', 'hooks.json'), cursorHooksJson(options.matchers));
  writeJson(path.join(cwd, '.cursor', 'mcp.json'), mcpJson());
  mkdirSync(path.join(cwd, '.cursor', 'rules'), { recursive: true });
  cpSync(
    path.join(findTemplateDir('rules'), 'openbox.mdc'),
    path.join(cwd, '.cursor', 'rules', 'openbox-governance.mdc'),
  );
  copyDir(findSkillDir(), cursorRepoSkillTargetDir(cwd));
  if (!options.skipRuntimeConfig) {
    writeRuntimeConfigTemplate(cursorRuntimeConfigDir(cwd));
  }
  return path.join(cwd, '.cursor');
}

export function uninstallCursorRepoMode(options: UninstallCursorRepoOptions = {}): void {
  const cwd = options.cwd ?? process.cwd();
  rmSync(path.join(cwd, '.cursor', 'hooks.json'), { force: true });
  rmSync(path.join(cwd, '.cursor', 'mcp.json'), { force: true });
  rmSync(path.join(cwd, '.cursor', 'rules', 'openbox-governance.mdc'), { force: true });
  if (options.removeSkill) {
    rmSync(cursorRepoSkillTargetDir(cwd), { recursive: true, force: true });
  }
}

function checkFile(name: string, file: string): CursorPluginCheck {
  return {
    name,
    status: existsSync(file) ? 'pass' : 'fail',
    path: file,
    detail: existsSync(file) ? 'present' : 'missing',
  };
}

function checkDirFiles(name: string, dir: string, expected: readonly string[]): CursorPluginCheck {
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

function checkHooks(file: string): CursorPluginCheck {
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
      const entry = value[0] as { command?: unknown; timeout?: unknown };
      if (entry.command !== HOOK_SPEC.command) {
        problems.push(`${event.name}: command drift`);
      }
      if (event.timeout !== undefined && entry.timeout !== event.timeout) {
        problems.push(`${event.name}: timeout ${String(entry.timeout)} != ${event.timeout}`);
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

function checkMcp(file: string): CursorPluginCheck {
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

export function verifyCursorPlugin(options: VerifyCursorPluginOptions = {}): CursorPluginCheck[] {
  const target = safeOutDir(options.target ?? cursorPluginTargetDir(options.cwd));
  const checks: CursorPluginCheck[] = [];
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
  checks.push(checkFile('plugin-manifest', path.join(target, '.cursor-plugin', 'plugin.json')));
  checks.push(checkFile('plugin-marketplace', path.join(target, '.cursor-plugin', 'marketplace.json')));
  checks.push(checkFile('plugin-workspace-open', path.join(target, 'workspaceOpen.json')));
  checks.push(checkFile('plugin-skill', path.join(target, 'skills', 'openbox', 'SKILL.md')));
  checks.push(checkDirFiles('plugin-commands', path.join(target, 'commands'), EXPECTED_COMMAND_FILES));
  checks.push(checkDirFiles('plugin-rules', path.join(target, 'rules'), EXPECTED_RULE_FILES));
  checks.push(checkDirFiles('plugin-agents', path.join(target, 'agents'), EXPECTED_AGENT_FILES));
  checks.push(checkHooks(path.join(target, 'hooks', 'hooks.json')));
  checks.push(checkMcp(path.join(target, 'mcp.json')));
  return checks;
}

export function verifyCursorRepoMode(options: VerifyCursorRepoOptions = {}): CursorPluginCheck[] {
  const cwd = options.cwd ?? process.cwd();
  const checks: CursorPluginCheck[] = [];
  checks.push(checkHooks(path.join(cwd, '.cursor', 'hooks.json')));
  checks.push(checkMcp(path.join(cwd, '.cursor', 'mcp.json')));
  checks.push(checkDirFiles('repo-rules', path.join(cwd, '.cursor', 'rules'), EXPECTED_REPO_RULE_FILES));
  checks.push(checkFile('repo-skill', path.join(cursorRepoSkillTargetDir(cwd), 'SKILL.md')));
  checks.push(checkFile('runtime-config', path.join(cursorRuntimeConfigDir(cwd), 'config.json')));
  return checks;
}
