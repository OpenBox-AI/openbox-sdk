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
import { HOOK_SPEC } from '../../core-client/generated/runtime/codex.js';
import {
  renderCodexAgentsMarkdown,
  renderCodexCommandRules,
  type RulesProjection,
} from '../../governance/rules-projection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EXPECTED_SKILL_FILES = ['SKILL.md'] as const;
const EXPECTED_PLUGIN_FILES = [
  '.codex-plugin/plugin.json',
  '.mcp.json',
  'AGENTS.md',
  '.codex/rules/openbox.rules',
  'assets',
  'hooks/hooks.json',
  'skills/openbox/SKILL.md',
] as const;

const MCP_SERVER = {
  command: 'openbox',
  args: ['mcp', 'serve'],
} as const;

export type CodexPluginCheckStatus = 'pass' | 'fail' | 'skip';

export interface CodexPluginCheck {
  name: string;
  status: CodexPluginCheckStatus;
  path?: string;
  detail?: string;
}

export interface ExportCodexPluginOptions {
  out: string;
  force?: boolean;
  matchers?: Record<string, string>;
  rulesProjection?: RulesProjection;
}

export interface InstallCodexPluginOptions {
  cwd?: string;
  target?: string;
  symlink?: string;
  matchers?: Record<string, string>;
  rulesProjection?: RulesProjection;
  skipRepoSkill?: boolean;
  skipMarketplace?: boolean;
}

export interface VerifyCodexPluginOptions {
  cwd?: string;
  target?: string;
  includeProjectSurfaces?: boolean;
}

export interface UninstallCodexPluginOptions {
  cwd?: string;
  target?: string;
  removeRepoSkill?: boolean;
  removeMarketplaceEntry?: boolean;
}

export function codexPluginTargetDir(cwd = process.cwd()): string {
  return path.join(cwd, '.agents', 'plugins', 'openbox');
}

export function codexRepoSkillTargetDir(cwd = process.cwd()): string {
  return path.join(cwd, '.agents', 'skills', 'openbox');
}

export function codexMarketplaceFile(cwd = process.cwd()): string {
  return path.join(cwd, '.agents', 'plugins', 'marketplace.json');
}

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf-8');
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
    `Could not find ${label} in any of:\n${candidates.map((candidate) => `  - ${candidate}`).join('\n')}`,
  );
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
    throw new Error(`Refusing to overwrite unsafe Codex plugin path: ${resolved}`);
  }
  return resolved;
}

function assertProjectTarget(target: string, cwd: string): string {
  const resolvedTarget = safeOutDir(target);
  const resolvedProject = path.resolve(cwd);
  const rel = path.relative(resolvedProject, resolvedTarget);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Codex plugin install target must be inside the project: ${resolvedProject}`);
  }
  return resolvedTarget;
}

function copyDir(src: string, dst: string): void {
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(path.dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: true });
}

function codexHooksJson(matchers?: Record<string, string>): Record<string, unknown> {
  const hooks: Record<string, Array<Record<string, unknown>>> = {};
  for (const event of HOOK_SPEC.events.filter((entry) => entry.installDefault !== false)) {
    const inner: Record<string, unknown> = {
      type: 'command',
      command: HOOK_SPEC.command,
    };
    if (event.timeout !== undefined) inner.timeout = event.timeout;
    const entry: Record<string, unknown> = {
      hooks: [inner],
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
      openbox: { ...MCP_SERVER },
    },
  };
}

function pluginManifest(version: string): Record<string, unknown> {
  return {
    name: 'openbox',
    version,
    description:
      'OpenBox AI governance for Codex: hooks, MCP tools, guardrails, policy checks, approvals, and reusable skills.',
    skills: './skills/',
    hooks: './hooks/hooks.json',
    mcp: './.mcp.json',
    interface: {
      displayName: 'OpenBox AI Governance',
      shortDescription: 'Govern Codex actions through OpenBox Core.',
    },
  };
}

function marketplaceManifest(version: string): Record<string, unknown> {
  return {
    name: 'openbox-local',
    plugins: [
      {
        name: 'openbox',
        source: {
          source: 'local',
          path: './openbox',
        },
        policy: {
          installation: 'AVAILABLE',
          authentication: 'ON_INSTALL',
        },
        category: 'Productivity',
        metadata: {
          version,
          description:
            'OpenBox governance bundle for Codex through hooks, MCP tools, skills, and Core-owned verdicts.',
        },
      },
    ],
  };
}

function defaultRulesProjection(): RulesProjection {
  return {
    agentId: 'openbox-core',
    fetchedAt: 'plugin-template',
    version: 1,
    rules: [],
  };
}

function agentsMarkdown(projection = defaultRulesProjection()): string {
  return renderCodexAgentsMarkdown(projection, {
    title: 'OpenBox Governance',
    skillName: 'openbox',
  });
}

function commandRules(projection = defaultRulesProjection()): string {
  return renderCodexCommandRules(projection);
}

export function exportCodexPlugin(options: ExportCodexPluginOptions): string {
  const out = safeOutDir(options.out);
  if (existsSync(out)) {
    if (options.force === false) {
      throw new Error(`Codex plugin output already exists: ${out}`);
    }
    rmSync(out, { recursive: true, force: true });
  }
  mkdirSync(out, { recursive: true });

  const version = packageVersion();
  const projection = options.rulesProjection ?? defaultRulesProjection();
  writeJson(path.join(out, '.codex-plugin', 'plugin.json'), pluginManifest(version));
  copyDir(findSkillDir(), path.join(out, 'skills', 'openbox'));
  writeJson(path.join(out, 'hooks', 'hooks.json'), codexHooksJson(options.matchers));
  writeJson(path.join(out, '.mcp.json'), mcpJson());
  writeFileSync(path.join(out, 'AGENTS.md'), agentsMarkdown(projection), 'utf-8');
  mkdirSync(path.join(out, '.codex', 'rules'), { recursive: true });
  writeFileSync(path.join(out, '.codex', 'rules', 'openbox.rules'), commandRules(projection), 'utf-8');
  mkdirSync(path.join(out, 'assets'), { recursive: true });
  return out;
}

export function installCodexPlugin(options: InstallCodexPluginOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const target = assertProjectTarget(options.target ?? codexPluginTargetDir(cwd), cwd);
  if (options.symlink) {
    const source = safeOutDir(options.symlink);
    if (!existsSync(source)) {
      throw new Error(`Codex plugin symlink source does not exist: ${source}`);
    }
    rmSync(target, { recursive: true, force: true });
    mkdirSync(path.dirname(target), { recursive: true });
    symlinkSync(source, target, 'dir');
  } else {
    exportCodexPlugin({
      out: target,
      matchers: options.matchers,
      rulesProjection: options.rulesProjection,
    });
  }
  if (!options.skipRepoSkill) {
    copyDir(findSkillDir(), codexRepoSkillTargetDir(cwd));
  }
  if (!options.skipMarketplace) {
    writeCodexMarketplace(cwd);
  }
  return target;
}

export function uninstallCodexPlugin(options: UninstallCodexPluginOptions = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const target = assertProjectTarget(options.target ?? codexPluginTargetDir(cwd), cwd);
  rmSync(target, { recursive: true, force: true });
  if (options.removeRepoSkill) {
    rmSync(codexRepoSkillTargetDir(cwd), { recursive: true, force: true });
  }
  if (options.removeMarketplaceEntry) {
    removeCodexMarketplaceEntry(cwd);
  }
}

function writeCodexMarketplace(cwd: string): void {
  const file = codexMarketplaceFile(cwd);
  const version = packageVersion();
  const next = marketplaceManifest(version);
  const existing = readJson(file);
  if (!existing || !Array.isArray(existing.plugins)) {
    writeJson(file, next);
    return;
  }
  const plugins = existing.plugins.filter(
    (entry) => !(entry && typeof entry === 'object' && (entry as { name?: unknown }).name === 'openbox'),
  );
  plugins.push((next.plugins as unknown[])[0]);
  writeJson(file, { ...existing, plugins });
}

function removeCodexMarketplaceEntry(cwd: string): void {
  const file = codexMarketplaceFile(cwd);
  const existing = readJson(file);
  if (!existing || !Array.isArray(existing.plugins)) return;
  const plugins = existing.plugins.filter(
    (entry) => !(entry && typeof entry === 'object' && (entry as { name?: unknown }).name === 'openbox'),
  );
  if (plugins.length === 0) {
    rmSync(file, { force: true });
    return;
  }
  writeJson(file, { ...existing, plugins });
}

function checkFile(name: string, file: string): CodexPluginCheck {
  return {
    name,
    status: existsSync(file) ? 'pass' : 'fail',
    path: file,
    detail: existsSync(file) ? 'present' : 'missing',
  };
}

function checkDirFiles(name: string, dir: string, expected: readonly string[]): CodexPluginCheck {
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

function checkHooks(file: string): CodexPluginCheck {
  const hooksJson = readJson(file);
  const hooks = hooksJson?.[HOOK_SPEC.key] as Record<string, unknown> | undefined;
  const problems: string[] = [];
  if (!hooks || typeof hooks !== 'object') {
    problems.push('hooks block missing');
  } else {
    for (const event of HOOK_SPEC.events.filter((entry) => entry.installDefault !== false)) {
      const value = hooks[event.name];
      if (!Array.isArray(value) || value.length === 0) {
        problems.push(`${event.name}: missing array entry`);
        continue;
      }
      const entry = value[0] as { hooks?: unknown };
      const hook = Array.isArray(entry.hooks)
        ? entry.hooks[0] as { command?: unknown; timeout?: unknown; type?: unknown } | undefined
        : undefined;
      if (hook?.type !== 'command') problems.push(`${event.name}: hook type drift`);
      if (hook?.command !== HOOK_SPEC.command) problems.push(`${event.name}: command drift`);
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

function checkMcp(file: string): CodexPluginCheck {
  const json = readJson(file);
  const openbox = (json?.mcpServers as Record<string, unknown> | undefined)?.openbox as
    | { args?: unknown; command?: unknown }
    | undefined;
  const ok =
    openbox?.command === MCP_SERVER.command &&
    Array.isArray(openbox.args) &&
    JSON.stringify(openbox.args) === JSON.stringify(MCP_SERVER.args);
  return {
    name: 'plugin-mcp',
    status: ok ? 'pass' : 'fail',
    path: file,
    detail: ok ? 'openbox mcp serve' : 'openbox server entry missing or malformed',
  };
}

function checkMarketplace(cwd: string): CodexPluginCheck {
  const file = codexMarketplaceFile(cwd);
  const json = readJson(file);
  const plugins = Array.isArray(json?.plugins) ? json.plugins : [];
  const ok = plugins.some(
    (entry) =>
      entry &&
      typeof entry === 'object' &&
      (entry as { name?: unknown }).name === 'openbox',
  );
  return {
    name: 'repo-marketplace',
    status: ok ? 'pass' : 'fail',
    path: file,
    detail: ok ? 'openbox marketplace entry present' : 'missing openbox marketplace entry',
  };
}

export function verifyCodexPlugin(options: VerifyCodexPluginOptions = {}): CodexPluginCheck[] {
  const cwd = options.cwd ?? process.cwd();
  const target = safeOutDir(options.target ?? codexPluginTargetDir(cwd));
  const checks: CodexPluginCheck[] = [];
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
  for (const file of EXPECTED_PLUGIN_FILES) {
    checks.push(checkFile(`plugin-${file.replace(/[/.]/g, '-')}`, path.join(target, file)));
  }
  checks.push(checkHooks(path.join(target, 'hooks', 'hooks.json')));
  checks.push(checkMcp(path.join(target, '.mcp.json')));
  if (options.includeProjectSurfaces) {
    checks.push(checkDirFiles('repo-skill', codexRepoSkillTargetDir(cwd), EXPECTED_SKILL_FILES));
    checks.push(checkMarketplace(cwd));
  }
  return checks;
}
