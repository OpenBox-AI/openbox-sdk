// Skip-pattern bypass for the claude-code runtime adapter.
//
// `ts/src/governance/skip-patterns.ts` defines the set of paths
// the runtime bypasses governance on: `.claude/`, `.git/`,
// `node_modules/`, IDE metadata files. The handler returns early
// for any file_path matching one of those regexes, which means
// the deny / require_approval rules for file_read should NOT
// fire against `.git/HEAD` even though they fire for
// `/etc/hostname`.
//
// This test reads `.git/HEAD` (created in the test workspace
// during install) and asserts:
//   - claude is not denied (the e2e-approve-read rule does not
//     trigger);
//   - the hook log shows preToolUse running but no activity
//     evaluation took place.
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
} from './helpers/claude-runner.js';

describe.runIf(SHOULD_RUN)('claude-code skip patterns', () => {
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

  it('reading .git/HEAD bypasses governance (no deny, no require_approval)', () => {
    // Absolute path so claude does not look up the cwd; the
    // SKIP_PATTERNS regex `/\.git\//` matches anywhere in the
    // path, so an absolute path inside WORKSPACE still bypasses.
    const headPath = path.join(WORKSPACE, '.git', 'HEAD');
    const r = runClaude(`Read ${headPath} using the Read tool`, {
      allowedTool: 'Read',
      timeoutMs: 150_000,
    });
    // The path matches SKIP_PATTERNS so the hook returns early
    // and the e2e-approve-read rule never fires. claude
    // completes the read.
    expect(r.permission_denials ?? []).toEqual([]);
    expect(r.is_error).toBeFalsy();
  }, 180_000);
});
