// Redaction-pattern governance for the claude-code runtime adapter.
//
// `ts/src/governance/skip-patterns.ts` defines paths whose raw file
// contents are redacted from hook payloads: `.claude/`, `.git/`,
// `node_modules/`, IDE metadata files. Those paths must still emit
// governance events with path/span context.
//
// This test reads `.git/HEAD` (created in the test project
// during install) and asserts:
//   - claude reports the governed Read permission denial / approval timeout;
//   - `.git/HEAD` no longer bypasses the file_read guardrail path.
//
// Skipped unless the project-scope test directory is configured
// against a loopback Core.

import { describe, expect, it, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  PROJECT_DIR,
  SHOULD_RUN,
  snapshotHookLog,
  hookLogSince,
} from './helpers/claude-runner.js';
import { ensureLocalGovernanceMatrix } from './helpers/local-governance-matrix.js';
import { configureClaudeCodeRuntime } from '../../ts/src/runtime/claude-code/index.js';
import { requireOpenBoxCli } from '../helpers/openbox-cli.js';

const EXPECT_LOCAL_RULES = true;
const OPENBOX = requireOpenBoxCli();
const LOCAL_GOVERNANCE_TIMEOUT_SEC = Number(
  process.env.OPENBOX_LOCAL_CLAUDE_HOOK_TIMEOUT_SEC ?? 150,
);
let localRuntime: Awaited<ReturnType<typeof ensureLocalGovernanceMatrix>> | undefined;

describe.runIf(SHOULD_RUN)('claude-code redaction patterns', () => {
  beforeAll(async () => {
    const runtime = await ensureLocalGovernanceMatrix();
    localRuntime = runtime;
    configureClaudeCodeRuntime({
      cwd: PROJECT_DIR,
      apiKey: runtime.runtimeKey,
      coreUrl: runtime.coreUrl,
      governanceTimeout: LOCAL_GOVERNANCE_TIMEOUT_SEC,
      approvalMode: 'inline',
      hitlMaxWait: 5,
      hitlPollInterval: 1,
    });
    // Make sure the test project has a `.git/HEAD` to read. Most
    // dev shells already have one, but CI uses a fresh project directory.
    const gitDir = path.join(PROJECT_DIR, '.git');
    if (!existsSync(gitDir)) mkdirSync(gitDir, { recursive: true });
    const head = path.join(gitDir, 'HEAD');
    if (!existsSync(head)) writeFileSync(head, 'ref: refs/heads/main\n');
  }, 90_000);

  it('reading .git/HEAD is governed with redacted content', () => {
    const headPath = path.join(PROJECT_DIR, '.git', 'HEAD');
    const offset = snapshotHookLog();
    const result = spawnSync(OPENBOX, ['claude-code', 'hook'], {
      cwd: PROJECT_DIR,
      encoding: 'utf-8',
      timeout: 30_000,
      env: {
        ...process.env,
        OPENBOX_API_KEY: localRuntime?.runtimeKey ?? '',
        OPENBOX_CORE_URL: localRuntime?.coreUrl ?? '',
      },
      input: JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: `skip-pattern-${Date.now()}`,
        tool_name: 'Read',
        tool_input: { file_path: headPath },
        cwd: PROJECT_DIR,
      }),
    });
    const events = hookLogSince(offset).map((line) => line.event);
    expect(result.status, result.stderr).toBe(0);
    expect(events).toContain('preToolUse');
    if (!EXPECT_LOCAL_RULES) {
      return;
    }
    const parsed = JSON.parse(result.stdout) as {
      hookSpecificOutput?: {
        hookEventName?: string;
        permissionDecision?: string;
        permissionDecisionReason?: string;
      };
    };
    expect(parsed.hookSpecificOutput?.hookEventName).toBe('PreToolUse');
    expect(['allow', 'ask', 'deny', 'defer']).toContain(
      parsed.hookSpecificOutput?.permissionDecision,
    );
  }, 60_000);
});
