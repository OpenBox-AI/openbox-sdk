// Test helper. Spawns `claude -p ...` inside a project-scope test
// workspace and returns the parsed JSON envelope. Shared across
// every `claude-code-*.test.ts` so each test stays focused on
// what it's asserting.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export const WORKSPACE =
  process.env.OPENBOX_E2E_CLAUDE_WORKSPACE ??
  path.join(homedir(), 'workspace', 'openbox-claude-test');
export const PLUGIN_DIR =
  process.env.OPENBOX_E2E_CLAUDE_PLUGIN_DIR ??
  path.join(WORKSPACE, '.claude', 'skills', 'openbox');
const DIST_CLI = path.resolve(import.meta.dirname, '../../../dist/cli/index.js');

export const SHOULD_RUN =
  process.env.OPENBOX_E2E_LIVE === '1' &&
  existsSync(path.join(PLUGIN_DIR, '.claude-plugin', 'plugin.json')) &&
  existsSync(path.join(WORKSPACE, '.claude-hooks', 'config.json'));

export const HOOK_LOG = path.join(
  WORKSPACE,
  '.claude-hooks',
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
  /** Hard ceiling on the spawn. Defaults to 150s; long enough for
   *  the SDK's `approvalMaxWaitMs` (60s) plus session boilerplate. */
  timeoutMs?: number;
  /** Extra env overrides. Merged after project-scope OpenBox env scrub. */
  env?: Record<string, string>;
}

const OPENBOX_RUNTIME_ENV = [
  'OPENBOX_API_KEY',
  'OPENBOX_CORE_URL',
  'OPENBOX_ENDPOINT',
  'OPENBOX_AGENT_DID',
  'OPENBOX_AGENT_PRIVATE_KEY',
  'OPENBOX_HOME',
  'GOVERNANCE_POLICY',
  'GOVERNANCE_TIMEOUT',
  'APPROVAL_MODE',
  'DRY_RUN',
  'HITL_ENABLED',
  'HITL_POLL_INTERVAL',
  'SESSION_DIR',
  'LOG_FILE',
  'SKIP_TOOLS',
  'SKIP_ACTIVITY_TYPES',
  'TASK_QUEUE',
] as const;

function claudeEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  // tests/setup.ts installs loopback defaults for unit clients. Claude Code
  // live tests must not leak those into the hook subprocess because the
  // project-local .claude-hooks/config.json is the runtime authority.
  for (const key of OPENBOX_RUNTIME_ENV) {
    delete env[key];
  }
  return {
    ...env,
    OPENBOX_CLI: process.env.OPENBOX_CLI ?? DIST_CLI,
    HITL_MAX_WAIT: '5',
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
    '--plugin-dir',
    PLUGIN_DIR,
    '--setting-sources',
    'user',
  ];
  if (opts.allowedTool !== undefined) {
    args.push('--allowedTools', opts.allowedTool);
  }
  // Default HITL_MAX_WAIT to 5s. Tests assert the verdict path,
  // not the polling window; a 5s ceiling is plenty for the SDK
  // adapter to register the require_approval and time out into a
  // soft deny that claude reports back as a permission denial.
  // The round-trip test (which actively decides the approval
  // mid-poll) overrides this through `opts.env` to a longer
  // window so the watcher can fire before the soft deny lands.
  const env = claudeEnv(opts.env);
  const result = spawnSync('claude', args, {
    cwd: WORKSPACE,
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

export interface HookLogLine {
  ts: string;
  event: string;
  verdict_kind?: 'permission' | 'observe' | 'none' | 'fallback';
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
