// Installer and verifier for Cursor hooks. Spec-driven: target file,
// JSON key, and hook command all come from `INSTALL_SPEC` (generated
// from `@installTarget` in `adapters.tsp`). All JSON-merge work lives
// in `install/from-spec.ts`; this module adds Cursor-specific
// completeness checks so "install cursor" can prove every expected
// surface landed.

import { INSTALL_SPEC } from '../../core-client/generated/runtime/cursor.js';
import {
  installAdapter,
  uninstallAdapter,
  type InstallOptions,
  type InstallSpec,
  resolveInstallPaths,
} from '../../install/from-spec.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadDotenv, loadJsonConfig } from '../../config/host-config.js';
import { listConfig, configStorePath } from '../../cli/config-store.js';
import { resolveConnection, validateApiKeyFormat } from '../../env/index.js';
import { OpenBoxCoreClient } from '../../core-client/index.js';

export interface InstallCursorOptions extends InstallOptions {
  /**
   * Per-event Cursor hook matcher regexes. Cursor evaluates the
   * matcher before invoking the hook command, so a properly-scoped
   * matcher cuts process spawns by an order of magnitude for
   * shell-heavy sessions.
   *
   * Map keys are event names from the cursor adapter spec
   * (`beforeShellExecution`, `beforeReadFile`, `preToolUse`, etc.);
   * values are regex strings. Events not present in the map fire on
   * every occurrence.
   *
   * Example:
   *   { beforeShellExecution: '\\b(rm|sudo|curl|wget|unlink|shred)\\b' }
   */
  matchers?: Record<string, string>;
}

function specWithMatchers(matchers?: Record<string, string>): InstallSpec {
  if (!matchers || Object.keys(matchers).length === 0) return INSTALL_SPEC;
  return {
    ...INSTALL_SPEC,
    events: INSTALL_SPEC.events.map((evt) =>
      matchers[evt.name] ? { ...evt, matcher: matchers[evt.name] } : evt,
    ),
  };
}

export function installCursor(opts: InstallCursorOptions = {}): void {
  const { matchers, ...installOpts } = opts;
  installAdapter(specWithMatchers(matchers), installOpts);
}

export function uninstallCursor(opts: InstallOptions = {}): void {
  uninstallAdapter(INSTALL_SPEC, opts);
}

export type CursorInstallCheckStatus = 'pass' | 'fail' | 'skip';

export interface CursorInstallCheck {
  name: string;
  status: CursorInstallCheckStatus;
  path?: string;
  detail?: string;
}

export interface VerifyCursorInstallOptions extends InstallOptions {
  /** Global installs include user-level bundles; project installs only
   *  verify project-scoped hooks/MCP. Override for tests. */
  includeUserSurfaces?: boolean;
  /** Include hook runtime readiness checks. Install flows keep this
   *  false so they can lay down files before a runtime key exists. */
  includeRuntime?: boolean;
  /** Validate the runtime key against core. Implies includeRuntime. */
  validateRuntime?: boolean;
}

const EXPECTED_COMMAND_FILES = [
  'openbox-check.md',
  'openbox-doctor.md',
  'openbox-list-agents.md',
  'openbox-pending.md',
  'openbox-status.md',
] as const;
const EXPECTED_RULE_FILES = ['openbox.mdc'] as const;
const EXPECTED_AGENT_FILES = ['openbox-reviewer.md'] as const;

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function checkDirFiles(name: string, dir: string, expected: readonly string[]): CursorInstallCheck {
  if (!fs.existsSync(dir)) {
    return { name, status: 'fail', path: dir, detail: 'directory missing' };
  }
  const present = new Set(fs.readdirSync(dir).filter((f) => expected.includes(f)));
  const missing = expected.filter((f) => !present.has(f));
  return {
    name,
    status: missing.length === 0 ? 'pass' : 'fail',
    path: dir,
    detail: missing.length === 0 ? `${expected.length} file(s)` : `missing: ${missing.join(', ')}`,
  };
}

function userCursorPath(...parts: string[]): string {
  return path.join(os.homedir(), '.cursor', ...parts);
}

function expectedExtensionVersion(): string | undefined {
  const candidates = [
    path.resolve(process.cwd(), 'apps/extension/package.json'),
    path.resolve('apps/extension/package.json'),
  ];
  for (const file of candidates) {
    const pkg = readJson(file);
    const version = pkg?.version;
    if (typeof version === 'string' && version) return version;
  }
  return undefined;
}

function checkExtensionInstall(): CursorInstallCheck {
  if (process.env.OPENBOX_SKIP_EXTENSION === '1') {
    return { name: 'extension', status: 'skip', detail: 'OPENBOX_SKIP_EXTENSION=1' };
  }
  const dir = userCursorPath('extensions');
  if (!fs.existsSync(dir)) {
    return { name: 'extension', status: 'fail', path: dir, detail: 'directory missing' };
  }
  const entries = fs
    .readdirSync(dir)
    .filter((entry) => /^openbox\.openbox[-.]/.test(entry) || /^openbox[-.]/.test(entry));
  if (entries.length === 0) {
    return { name: 'extension', status: 'fail', path: dir, detail: 'OpenBox extension missing' };
  }
  const expected = expectedExtensionVersion();
  for (const entry of entries) {
    const pkgFile = path.join(dir, entry, 'package.json');
    const pkg = readJson(pkgFile);
    const actual = typeof pkg?.version === 'string' ? pkg.version : undefined;
    if (!expected || actual === expected) {
      return {
        name: 'extension',
        status: 'pass',
        path: pkgFile,
        detail: `installed${actual ? ` ${actual}` : ''}; reload Cursor to verify loaded code`,
      };
    }
  }
  return {
    name: 'extension',
    status: 'fail',
    path: dir,
    detail: expected ? `installed version does not match expected ${expected}` : 'package version unreadable',
  };
}

function truthy(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

function isPlaceholderKey(value: string | undefined): boolean {
  if (!value) return false;
  return /YOUR_API_KEY|REPLACE_ME|placeholder/i.test(value);
}

function buildHookRuntimeEnv(paths: ReturnType<typeof resolveInstallPaths>) {
  const values: Record<string, string> = {};
  const fill = (src: Record<string, string>) => {
    for (const [key, value] of Object.entries(src)) {
      if (process.env[key] !== undefined) values[key] = process.env[key]!;
      else if (values[key] === undefined) values[key] = value;
    }
  };

  fill(listConfig());

  const fileConfig = loadJsonConfig(path.join(paths.configDir, 'config.json'));
  const envFile = loadDotenv(path.join(paths.configDir, '.env'));
  const get = (key: string): string | undefined =>
    process.env[key] ?? values[key] ?? fileConfig[key] ?? envFile[key];

  const connection = resolveConnection({
    apiUrl: get('OPENBOX_API_URL'),
    coreUrl: get('OPENBOX_CORE_URL'),
    platformUrl: get('OPENBOX_PLATFORM_URL'),
  });
  const coreUrl = connection.coreUrl;
  const apiKey = get('OPENBOX_API_KEY') ?? '';
  return {
    configDir: paths.configDir,
    configFile: path.join(paths.configDir, 'config.json'),
    envFile: path.join(paths.configDir, '.env'),
    globalConfigFile: configStorePath(),
    coreUrl,
    apiKey,
    dryRun: truthy(get('DRY_RUN')),
  };
}

async function checkRuntimeReadiness(
  paths: ReturnType<typeof resolveInstallPaths>,
  validateRuntime: boolean,
): Promise<CursorInstallCheck> {
  const runtime = buildHookRuntimeEnv(paths);
  const details = [
    `config=${runtime.configFile}`,
    `global=${runtime.globalConfigFile}`,
    `core=${runtime.coreUrl}`,
    `dryRun=${runtime.dryRun}`,
  ];
  if (runtime.dryRun) {
    return { name: 'runtime', status: 'fail', path: runtime.configFile, detail: `${details.join('; ')}; DRY_RUN=true` };
  }
  if (!runtime.apiKey) {
    return { name: 'runtime', status: 'fail', path: runtime.configFile, detail: `${details.join('; ')}; missing OPENBOX_API_KEY` };
  }
  if (isPlaceholderKey(runtime.apiKey)) {
    return { name: 'runtime', status: 'fail', path: runtime.configFile, detail: `${details.join('; ')}; placeholder OPENBOX_API_KEY` };
  }
  const format = validateApiKeyFormat(runtime.apiKey);
  if (format !== true) {
    return { name: 'runtime', status: 'fail', path: runtime.configFile, detail: `${details.join('; ')}; invalid OPENBOX_API_KEY format: ${format}` };
  }
  if (!validateRuntime) {
    return { name: 'runtime', status: 'pass', path: runtime.configFile, detail: `${details.join('; ')}; key=format-ok` };
  }
  try {
    const core = new OpenBoxCoreClient({
      apiKey: runtime.apiKey,
      apiUrl: runtime.coreUrl,
      timeoutMs: 5_000,
    });
    const validation = (await core.validateApiKey()) as { agent_id?: string } | undefined;
    const agent = validation?.agent_id ? `; agent=${validation.agent_id}` : '';
    return { name: 'runtime', status: 'pass', path: runtime.configFile, detail: `${details.join('; ')}; key=validated${agent}` };
  } catch (err: any) {
    return {
      name: 'runtime',
      status: 'fail',
      path: runtime.configFile,
      detail: `${details.join('; ')}; core validation failed: ${String(err?.message ?? err)}`,
    };
  }
}

export function verifyCursorInstall(
  opts?: VerifyCursorInstallOptions & { includeRuntime?: false; validateRuntime?: false },
): CursorInstallCheck[];
export function verifyCursorInstall(
  opts: VerifyCursorInstallOptions & ({ includeRuntime: true } | { validateRuntime: true }),
): Promise<CursorInstallCheck[]>;
export function verifyCursorInstall(
  opts: VerifyCursorInstallOptions = {},
): CursorInstallCheck[] | Promise<CursorInstallCheck[]> {
  const scope = opts.scope ?? 'global';
  const includeUserSurfaces = opts.includeUserSurfaces ?? scope === 'global';
  const paths = resolveInstallPaths(INSTALL_SPEC, opts);
  const checks: CursorInstallCheck[] = [];

  const hooksJson = readJson(paths.hooksFile);
  const hooks = hooksJson?.[INSTALL_SPEC.key] as Record<string, unknown> | undefined;
  const hookProblems: string[] = [];
  if (!hooks || typeof hooks !== 'object') {
    hookProblems.push('hooks block missing');
  } else {
    for (const evt of INSTALL_SPEC.events) {
      const value = hooks[evt.name];
      if (!Array.isArray(value) || value.length === 0) {
        hookProblems.push(`${evt.name}: missing array entry`);
        continue;
      }
      const entry = value[0] as { command?: unknown; timeout?: unknown };
      if (entry.command !== INSTALL_SPEC.command) {
        hookProblems.push(`${evt.name}: command drift`);
      }
      if (evt.timeout !== undefined && entry.timeout !== evt.timeout) {
        hookProblems.push(`${evt.name}: timeout ${String(entry.timeout)} != ${evt.timeout}`);
      }
    }
  }
  checks.push({
    name: 'hooks',
    status: hookProblems.length === 0 ? 'pass' : 'fail',
    path: paths.hooksFile,
    detail: hookProblems.length === 0 ? `${INSTALL_SPEC.events.length} event(s)` : hookProblems.join('; '),
  });

  const mcpJson = readJson(paths.mcpFile);
  const openbox = (mcpJson?.mcpServers as Record<string, unknown> | undefined)?.openbox as
    | { command?: unknown; args?: unknown }
    | undefined;
  const mcpOk =
    openbox?.command === 'openbox' &&
    Array.isArray(openbox.args) &&
    openbox.args.includes('mcp') &&
    openbox.args.includes('serve');
  checks.push({
    name: 'mcp',
    status: mcpOk ? 'pass' : 'fail',
    path: paths.mcpFile,
    detail: mcpOk ? 'openbox mcp serve' : 'openbox server entry missing or malformed',
  });

  if (!includeUserSurfaces) {
    checks.push({
      name: 'user-surfaces',
      status: 'skip',
      detail: 'project-scoped install only verifies project hooks and MCP',
    });
    if (opts.includeRuntime || opts.validateRuntime) {
      return checkRuntimeReadiness(paths, Boolean(opts.validateRuntime)).then((runtime) => [...checks, runtime]);
    }
    return checks;
  }

  checks.push(checkExtensionInstall());
  checks.push(checkDirFiles('slash-commands', userCursorPath('commands'), EXPECTED_COMMAND_FILES));
  checks.push(checkDirFiles('rules', userCursorPath('rules'), EXPECTED_RULE_FILES));
  checks.push(checkDirFiles('agents', userCursorPath('agents'), EXPECTED_AGENT_FILES));

  const skill = userCursorPath('skills', 'openbox', 'SKILL.md');
  checks.push({
    name: 'skill',
    status: fs.existsSync(skill) ? 'pass' : 'fail',
    path: skill,
    detail: fs.existsSync(skill) ? 'installed' : 'missing',
  });

  if (opts.includeRuntime || opts.validateRuntime) {
    return checkRuntimeReadiness(paths, Boolean(opts.validateRuntime)).then((runtime) => [...checks, runtime]);
  }
  return checks;
}
