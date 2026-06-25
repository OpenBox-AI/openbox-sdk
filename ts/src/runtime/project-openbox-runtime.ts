import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_NAME = '@openbox-ai/openbox-sdk';
const SDK_LINK_RELATIVE = path.join('.openbox', 'sdk');
const RUNNER_RELATIVE = path.join('.openbox', 'bin', 'openbox');
const RUNNER_MODULE_RELATIVE = path.join('.openbox', 'bin', 'openbox.mjs');
const SDK_CLI_RELATIVE = path.join('dist', 'cli', 'index.js');

export interface ProjectOpenBoxRuntimeCheck {
  name: string;
  status: 'pass' | 'fail';
  path?: string;
  detail?: string;
}

export interface EnsureProjectOpenBoxRuntimeOptions {
  cwd?: string;
  gitignoreEntries?: string[];
}

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function findPackageRoot(startFile = fileURLToPath(import.meta.url)): string {
  let cur = path.dirname(startFile);
  for (let i = 0; i < 12; i += 1) {
    const pkg = readJson(path.join(cur, 'package.json'));
    if (pkg?.name === PACKAGE_NAME) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  throw new Error(`Could not find ${PACKAGE_NAME} package root from ${startFile}`);
}

export function projectOpenBoxRunner(cwd = process.cwd()): string {
  return path.join(cwd, RUNNER_RELATIVE);
}

export function projectOpenBoxRunnerModule(cwd = process.cwd()): string {
  return path.join(cwd, RUNNER_MODULE_RELATIVE);
}

export function projectOpenBoxSdkCli(cwd = process.cwd()): string {
  return path.join(cwd, SDK_LINK_RELATIVE, SDK_CLI_RELATIVE);
}

export function projectOpenBoxHookCommand(host: 'claude-code' | 'codex' | 'cursor'): string {
  return `./${RUNNER_RELATIVE} ${host} hook`;
}

export function projectOpenBoxMcpServerEntry(): { command: string; args: string[] } {
  return {
    command: `./${RUNNER_RELATIVE}`,
    args: ['mcp', 'serve'],
  };
}

function runnerSource(label: string): string {
  return [
    '#!/usr/bin/env node',
    "import { existsSync } from 'node:fs';",
    "import path from 'node:path';",
    "import { spawnSync } from 'node:child_process';",
    "import { fileURLToPath } from 'node:url';",
    '',
    'const args = process.argv.slice(2);',
    `const label = ${JSON.stringify(label)};`,
    "const scriptDir = path.dirname(fileURLToPath(import.meta.url));",
    '',
    'function addAncestors(out, root) {',
    '  if (!root) return;',
    '  let cur = path.resolve(root);',
    '  for (let i = 0; i < 10; i += 1) {',
    '    if (!out.includes(cur)) out.push(cur);',
    '    const parent = path.dirname(cur);',
    '    if (parent === cur) break;',
    '    cur = parent;',
    '  }',
    '}',
    '',
    'function projectRoots() {',
    '  const out = [];',
    '  addAncestors(out, process.env.OPENBOX_PROJECT_DIR);',
    '  addAncestors(out, process.env.CLAUDE_PROJECT_DIR);',
    '  addAncestors(out, process.env.CODEX_PROJECT_DIR);',
    '  addAncestors(out, process.env.CURSOR_PROJECT_DIR);',
    '  addAncestors(out, process.cwd());',
    '  addAncestors(out, scriptDir);',
    '  return out;',
    '}',
    '',
    'function cliCandidates() {',
    '  const candidates = [];',
    '  for (const root of projectRoots()) {',
    "    candidates.push(path.join(root, '.openbox', 'sdk', 'dist', 'cli', 'index.js'));",
    "    candidates.push(path.join(root, 'node_modules', '@openbox-ai', 'openbox-sdk', 'dist', 'cli', 'index.js'));",
    '  }',
    '  return candidates;',
    '}',
    '',
    'function resolveCli() {',
    '  for (const candidate of cliCandidates()) {',
    '    if (existsSync(candidate)) return candidate;',
    '  }',
    '  return undefined;',
    '}',
    '',
    'const cli = resolveCli();',
    'if (!cli) {',
    "  console.error(`OpenBox SDK CLI not found for ${label}. Run \\`openbox install <host> --cwd <project>\\` or install @openbox-ai/openbox-sdk in the project.`);",
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
  ].join('\n');
}

export function writeOpenBoxCliRunner(file: string, label: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, runnerSource(label), 'utf-8');
  chmodSync(file, 0o755);
}

function writeProjectRunnerShim(file: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    [
      '#!/usr/bin/env sh',
      'set -eu',
      'DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"',
      'exec node "$DIR/openbox.mjs" "$@"',
      '',
    ].join('\n'),
    'utf-8',
  );
  chmodSync(file, 0o755);
}

function ensureSdkLink(cwd: string): void {
  const link = path.join(cwd, SDK_LINK_RELATIVE);
  const cli = projectOpenBoxSdkCli(cwd);
  if (existsSync(cli)) return;

  let linkStat: ReturnType<typeof lstatSync> | undefined;
  try {
    linkStat = lstatSync(link);
  } catch {
    linkStat = undefined;
  }
  if (linkStat) {
    if (!linkStat.isSymbolicLink()) {
      throw new Error(`OpenBox SDK runtime path exists but is not managed by OpenBox: ${link}`);
    }
    rmSync(link, { force: true });
  }

  const packageRoot = findPackageRoot();
  if (!existsSync(path.join(packageRoot, SDK_CLI_RELATIVE))) {
    throw new Error(`OpenBox SDK CLI is not built at ${path.join(packageRoot, SDK_CLI_RELATIVE)}; run npm run build first.`);
  }
  mkdirSync(path.dirname(link), { recursive: true });
  symlinkSync(packageRoot, link, 'dir');
}

function ensureGitignore(cwd: string, extraEntries: string[]): void {
  const file = path.join(cwd, '.gitignore');
  const entries = ['.openbox/', ...extraEntries];
  const before = existsSync(file) ? readFileSync(file, 'utf-8') : '';
  const missing = entries.filter((entry) => !before.split(/\r?\n/).includes(entry));
  if (missing.length === 0) return;
  const prefix = before.trimEnd().length > 0 ? `${before.trimEnd()}\n\n` : '';
  writeFileSync(
    file,
    `${prefix}# OpenBox local runtime state\n${missing.join('\n')}\n`,
    'utf-8',
  );
}

export function ensureProjectOpenBoxRuntime(
  options: EnsureProjectOpenBoxRuntimeOptions | string = {},
): void {
  const cwd = typeof options === 'string'
    ? options
    : options.cwd ?? process.cwd();
  const gitignoreEntries = typeof options === 'string'
    ? []
    : options.gitignoreEntries ?? [];
  ensureSdkLink(cwd);
  writeOpenBoxCliRunner(projectOpenBoxRunnerModule(cwd), 'project runtime');
  writeProjectRunnerShim(projectOpenBoxRunner(cwd));
  ensureGitignore(cwd, gitignoreEntries);
}

export function checkProjectOpenBoxRuntime(cwd = process.cwd()): ProjectOpenBoxRuntimeCheck {
  const runner = projectOpenBoxRunner(cwd);
  const cli = projectOpenBoxSdkCli(cwd);
  if (!existsSync(runner)) {
    return {
      name: 'openbox-runtime',
      status: 'fail',
      path: runner,
      detail: 'missing project runner; run `openbox install <host> --cwd <project>`',
    };
  }
  if (!existsSync(cli)) {
    return {
      name: 'openbox-runtime',
      status: 'fail',
      path: cli,
      detail: 'missing SDK CLI link; run `openbox install <host> --cwd <project>`',
    };
  }
  return {
    name: 'openbox-runtime',
    status: 'pass',
    path: runner,
    detail: 'project runner and SDK CLI link present',
  };
}
