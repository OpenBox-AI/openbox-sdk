// Fail-open behavior for the claude-code runtime adapter.
//
// `GOVERNANCE_POLICY=fail_open` is the default for the local test
// workspace, but the path matters: if the backend goes away (port
// unreachable, DNS failure, partial deploy) the hook subprocess
// must still let claude proceed. A fail-closed misconfiguration
// would silently shut down the IDE for the user, which is the worst
// possible degradation.
//
// This test points the hook at an obviously dead port and asserts
// claude is not denied. We override OPENBOX_CORE_URL via the
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

describe.runIf(SHOULD_RUN)('claude-code fail-open behavior', () => {
  beforeAll(() => {
    assertClaudeOnPath();
  });

  it('unreachable core URL with fail_open still lets claude proceed', () => {
    const r = runClaude('Run shell: echo fail-open-probe', {
      allowedTool: 'Bash',
      timeoutMs: 60_000,
      env: {
        OPENBOX_CORE_URL: DEAD_CORE,
        GOVERNANCE_POLICY: 'fail_open',
      },
    });
    // The shell action proceeds; no rule fired because the hook
    // could not reach the backend, so fail_open returns allow.
    expect(r.permission_denials ?? []).toEqual([]);
    expect(r.is_error).toBeFalsy();
  }, 90_000);
});
