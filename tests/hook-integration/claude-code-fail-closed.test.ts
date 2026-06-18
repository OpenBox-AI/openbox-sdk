// Fail-closed behavior for the claude-code runtime adapter.
//
// If Core is unreachable, decision-capable hooks deny/block rather
// than silently allowing Claude Code to proceed. Stale configs that
// still set `GOVERNANCE_POLICY=fail_open` are normalized to fail-closed.
//
// This test points the hook at an obviously dead port and asserts
// claude is denied. We override OPENBOX_CORE_URL via the
// process env passed to claude; the hook subprocess inherits and
// loadConfig() prefers process.env over the project config file.
//
// Skipped unless OPENBOX_E2E_LIVE=1 and the project-scope test
// workspace is configured.

import { describe, expect, it, beforeAll } from 'vitest';
import {
  runClaude,
  SHOULD_RUN,
  assertClaudeOnPath,
} from './helpers/claude-runner.js';

// 127.0.0.1:1 refuses connection on every reasonable host; the
// kernel rejects before any HTTP exchange happens, so the hook's
// fetch surfaces a transport error fast.
const DEAD_CORE = 'http://127.0.0.1:1';

describe.runIf(SHOULD_RUN)('claude-code fail-closed behavior', () => {
  beforeAll(() => {
    assertClaudeOnPath();
  });

  it('unreachable core URL denies even when stale config asks for fail_open', () => {
    const r = runClaude('Run shell: echo fail-closed-probe', {
      allowedTool: 'Bash',
      timeoutMs: 60_000,
      env: {
        OPENBOX_CORE_URL: DEAD_CORE,
        GOVERNANCE_POLICY: 'fail_open',
      },
    });
    const denied = r.permission_denials?.some((d) => d.tool_name === 'Bash');
    const promptBlocked =
      r.result.includes('UserPromptSubmit operation blocked by hook') &&
      r.result.includes('[OpenBox]') &&
      r.result.includes('governance failed');
    expect(denied || promptBlocked).toBe(true);
  }, 90_000);
});
