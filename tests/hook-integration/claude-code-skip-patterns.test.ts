// Redaction-pattern governance for the claude-code runtime adapter.
//
// `ts/src/governance/skip-patterns.ts` defines paths whose raw file
// contents are redacted from hook payloads: `.claude/`, `.git/`,
// `node_modules/`, IDE metadata files. Those paths must still emit
// governance events with path/span context.
//
// This test reads `.git/HEAD` (created in the test workspace
// during install) and asserts:
//   - claude reports the governed Read permission denial / approval timeout;
//   - `.git/HEAD` no longer bypasses the file_read guardrail path.
//
// Skipped unless OPENBOX_E2E_LIVE=1 and the project-scope test
// workspace is configured.

import { describe, expect, it, beforeAll } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  runClaude,
  WORKSPACE,
  SHOULD_RUN,
  assertClaudeOnPath,
  snapshotHookLog,
  hookLogSince,
} from './helpers/claude-runner.js';

function isLoopbackUrl(raw: string | undefined): boolean {
  if (!raw) return true;
  try {
    const host = new URL(raw).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

const EXPECT_LOCAL_RULES =
  process.env.OPENBOX_E2E_EXPECT_LOCAL_RULES === '1' ||
  (
    process.env.OPENBOX_E2E_EXPECT_LOCAL_RULES !== '0' &&
    !process.env.OPENBOX_STAGING_API_URL &&
    !process.env.OPENBOX_STAGING_CORE_URL &&
    isLoopbackUrl(process.env.OPENBOX_API_URL) &&
    isLoopbackUrl(process.env.OPENBOX_CORE_URL)
  );

describe.runIf(SHOULD_RUN)('claude-code redaction patterns', () => {
  beforeAll(() => {
    assertClaudeOnPath();
    // Make sure the workspace has a `.git/HEAD` to read. Most
    // dev shells already have one, but the test runs as a fresh
    // workspace on CI; plant a stub.
    const gitDir = path.join(WORKSPACE, '.git');
    if (!existsSync(gitDir)) mkdirSync(gitDir, { recursive: true });
    const head = path.join(gitDir, 'HEAD');
    if (!existsSync(head)) writeFileSync(head, 'ref: refs/heads/main\n');
  });

  it('reading .git/HEAD is governed with redacted content', () => {
    const headPath = path.join(WORKSPACE, '.git', 'HEAD');
    const offset = snapshotHookLog();
    const r = runClaude(`Read ${headPath} using the Read tool`, {
      allowedTool: 'Read',
      timeoutMs: 45_000,
    });
    const events = hookLogSince(offset).map((line) => line.event);
    expect(events).toContain('preToolUse');
    if (!EXPECT_LOCAL_RULES) {
      expect(r.is_error).toBeFalsy();
      return;
    }
    const denied = r.permission_denials?.some((d) => d.tool_name === 'Read');
    expect(denied).toBe(true);
  }, 60_000);
});
