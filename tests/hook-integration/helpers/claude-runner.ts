// Test helper. Spawns `claude -p ...` inside a project-scope test
// directory and returns the parsed JSON envelope. Shared across
// every `claude-code-*.test.ts` so each test stays focused on
// what it's asserting.

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const PROJECT_DIR =
  process.env.OPENBOX_CLAUDE_HEADLESS_CWD ?? path.join(tmpdir(), 'openbox-claude-headless');
export const PLUGIN_DIR =
  path.join(PROJECT_DIR, '.claude', 'skills', 'openbox');

export const SHOULD_RUN =
  existsSync(path.join(PLUGIN_DIR, '.claude-plugin', 'plugin.json')) &&
  existsSync(path.join(PROJECT_DIR, '.claude', 'settings.local.json')) &&
  existsSync(path.join(PROJECT_DIR, '.openbox', 'claude-code', 'config.json')) &&
  projectCoreIsLoopback();

export const HOOK_LOG = path.join(
  PROJECT_DIR,
  '.openbox',
  'claude-code',
  'log',
  'claude-code-hook.jsonl',
);

export interface ClaudeResult {
  result: string;
  session_id?: string;
  permission_denials?: Array<{
    tool_name: string;
    tool_input?: unknown;
  }>;
  is_error?: boolean;
}

export interface RunOptions {
  /** Per-run override for `--allowedTools`. Empty string means
   *  the prompt should answer without any tool. */
  allowedTool?: string;
  /** Per-run override for `--tools`; defaults to allowedTool for
   *  official built-in tool-catalog narrowing. */
  tools?: string;
  /** Hard ceiling on the spawn. Defaults to 150s; long enough for
   *  the SDK's `approvalMaxWaitMs` (60s) plus session boilerplate. */
  timeoutMs?: number;
  /** Extra env overrides. Merged after project-scope OpenBox env scrub. */
  env?: Record<string, string>;
  /** Explicit Claude Code session id. Defaults to a fresh UUID per run. */
  sessionId?: string;
}

const RUNTIME_ENV_KEYS = [
  'OPENBOX_API_KEY',
  'OPENBOX_CORE_URL',
  'OPENBOX_AGENT_DID',
  'OPENBOX_AGENT_PRIVATE_KEY',
  'OPENBOX_HOME',
] as const;

function claudeEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  // tests/setup.ts installs loopback defaults for unit clients. Claude Code
  // live tests must not leak those into the hook subprocess because the
  // project-local `.claude/settings.local.json` env is the runtime authority.
  for (const key of RUNTIME_ENV_KEYS) {
    delete env[key];
  }
  delete env.NODE_V8_COVERAGE;
  delete env.VITEST;
  delete env.VITEST_POOL_ID;
  delete env.VITEST_WORKER_ID;
  return {
    ...env,
    ...overrides,
  };
}

export function runClaude(prompt: string, opts: RunOptions = {}): ClaudeResult {
  const args = [
    '-p',
    prompt,
    '--output-format',
    'json',
    '--dangerously-skip-permissions',
    '--no-session-persistence',
    '--session-id',
    opts.sessionId ?? randomUUID(),
    '--plugin-dir',
    PLUGIN_DIR,
    '--setting-sources',
    'user',
  ];
  if (opts.allowedTool !== undefined) {
    args.push('--allowedTools', opts.allowedTool);
    const tools = opts.tools ?? opts.allowedTool;
    if (tools.trim().length > 0) {
      args.push('--tools', tools);
    }
  }
  const env = claudeEnv(opts.env);
  const result = spawnSync('claude', args, {
    cwd: PROJECT_DIR,
    encoding: 'utf-8',
    timeout: opts.timeoutMs ?? 150_000,
    input: '',
    env,
  });
  if (result.status !== 0 && !result.stdout) {
    throw new Error(
      `claude -p exited ${result.status}; stderr: ${result.stderr}`,
    );
  }
  const text = result.stdout.trim();
  const start = text.indexOf('{');
  if (start < 0) {
    throw new Error(`no JSON in claude -p output: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text.slice(start)) as ClaudeResult;
}

function projectCoreIsLoopback(): boolean {
  const configPath = path.join(PROJECT_DIR, '.claude', 'settings.local.json');
  if (!existsSync(configPath)) return false;
  try {
    const settings = JSON.parse(
      readFileSync(configPath, 'utf-8'),
    ) as { env?: { OPENBOX_CORE_URL?: string } };
    const coreUrl = settings.env?.OPENBOX_CORE_URL;
    if (!coreUrl) return false;
    const host = new URL(coreUrl).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

export interface HookLogLine {
  ts: string;
  event: string;
  verdict_kind?: 'permission' | 'observe' | 'none';
  session_id?: string;
  tool_name?: string;
  decision?: string;
  reason?: string;
  governance_event_id?: string;
  governance_checks_incomplete?: boolean;
  took_ms?: number;
  error?: string | null;
}

/** Snapshot the hook log size before running, then return everything
 *  appended after the snapshot. Captures events from the current
 *  claude session (or whichever spawn ran between snapshots). */
export function snapshotHookLog(): number {
  try {
    return readFileSync(HOOK_LOG, 'utf-8').length;
  } catch {
    return 0;
  }
}

export function hookLogSince(offset: number): HookLogLine[] {
  try {
    const text = readFileSync(HOOK_LOG, 'utf-8').slice(offset);
    return text
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as HookLogLine);
  } catch {
    return [];
  }
}

/** Probe that `claude` is on PATH. Throws with a clear message so
 *  tests fail fast instead of timing out per-case. */
export function assertClaudeOnPath(): void {
  const v = spawnSync('claude', ['--version'], { encoding: 'utf-8' });
  if (v.status !== 0) {
    throw new Error(`claude CLI not on PATH: ${v.stderr}`);
  }
}
