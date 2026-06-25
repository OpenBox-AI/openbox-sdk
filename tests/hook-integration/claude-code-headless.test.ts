// Headless end-to-end matrix for the claude-code runtime adapter.
//
// Spawns `claude -p ...` with the project-scope OpenBox plugin loaded
// through `--plugin-dir` and asserts that each rule planted by the local
// bootstrap fires through the hook subprocess. Mirrors the cursor
// wdio suite's verdict matrix (sourced from the same shared
// fixture under `fixtures/verdict-matrix.ts`) so adding a host
// adds one runner, not a duplicate matrix.
//
// Skipped unless `OPENBOX_CLAUDE_HEADLESS_CWD` points at a test project
// configured against a loopback Core and containing
//     `.claude/skills/openbox`, `.claude/settings.local.json`, and
//     `.openbox/claude-code/config.json`
//
// Set up the project once with:
//
//   openbox claude-code plugin install --scope project \
//     --cwd "$OPENBOX_CLAUDE_HEADLESS_CWD" \
//     --runtime-api-key <obx_test_or_live_key> \
//     --core-url http://127.0.0.1:8086
//
// Run through `npm run test:hook-integration`.

import { describe, expect, it, beforeAll } from 'vitest';
import {
  CLAUDE_CODE_HOOK_VERDICT_MATRIX,
  type VerdictMatrixCase,
  requireProviderDriver,
} from './fixtures/verdict-matrix.js';
import {
  runClaude,
  SHOULD_RUN,
  PROJECT_DIR,
  assertClaudeOnPath,
  snapshotHookLog,
  hookLogSince,
} from './helpers/claude-runner.js';
import { ensureLocalGovernanceMatrix } from './helpers/local-governance-matrix.js';
import { configureClaudeCodeRuntime } from '../../ts/src/runtime/claude-code/index.js';

const EXPECT_LOCAL_RULES = true;
const CASE_ID_FILTER = process.env.OPENBOX_CLAUDE_HOST_CASE_ID;
const LOCAL_GOVERNANCE_TIMEOUT_SEC = Number(
  process.env.OPENBOX_LOCAL_CLAUDE_HOOK_TIMEOUT_SEC ?? 150,
);

function prompt(c: VerdictMatrixCase): { prompt: string; tool: string } | null {
  const driver = requireProviderDriver(c, 'claude-code', 'hook');
  const tmpFile = `/tmp/openbox-claude-write-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`;
  const text = driver.prompt ?? driver.promptTemplate?.replace('{tmpFile}', tmpFile);
  return text ? { prompt: text, tool: driver.tool } : null;
}

function logShowsDeniedRule(
  lines: ReturnType<typeof hookLogSince>,
  c: VerdictMatrixCase,
): boolean {
  return lines.some((line) => (
    line.verdict_kind === 'permission'
    && ['block', 'deny', 'halt'].includes(String(line.decision ?? '').toLowerCase())
    && (line.reason ?? '').includes(c.expectedRule)
  ));
}

function runClaudeUntilExpectedEvent(
  driver: { prompt: string; tool: string },
): {
  result?: ReturnType<typeof runClaude>;
  lines: ReturnType<typeof hookLogSince>;
  error?: Error;
} {
  let last: {
    result?: ReturnType<typeof runClaude>;
    lines: ReturnType<typeof hookLogSince>;
    error?: Error;
  } | undefined;
  const maxAttempts = driver.tool ? 2 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const offset = snapshotHookLog();
    let result: ReturnType<typeof runClaude> | undefined;
    let error: Error | undefined;
    try {
      result = runClaude(driver.prompt, {
        allowedTool: driver.tool,
        timeoutMs: Number(process.env.OPENBOX_CLAUDE_HEADLESS_TIMEOUT_MS ?? 240_000),
      });
    } catch (err) {
      error = err instanceof Error ? err : new Error(String(err));
    }
    const lines = hookLogSince(offset);
    last = { result, lines, error };
    const events = lines.map((line) => line.event);
    if (!driver.tool || events.includes('preToolUse')) return last;
  }
  if (!last) throw new Error('Claude Code host did not return a result');
  return last;
}

describe.runIf(SHOULD_RUN)('claude-code headless host matrix', () => {
  beforeAll(async () => {
    assertClaudeOnPath();
    const runtime = await ensureLocalGovernanceMatrix();
    configureClaudeCodeRuntime({
      cwd: PROJECT_DIR,
      apiKey: runtime.runtimeKey,
      coreUrl: runtime.coreUrl,
      governanceTimeout: LOCAL_GOVERNANCE_TIMEOUT_SEC,
      approvalMode: 'remote',
      hitlMaxWait: 5,
      hitlPollInterval: 1,
    });
  }, 180_000);

  for (const c of CLAUDE_CODE_HOOK_VERDICT_MATRIX.filter((entry) => (
    !CASE_ID_FILTER || entry.id === CASE_ID_FILTER
  ))) {
    const driver = prompt(c);

    it(
      c.name,
      () => {
        expect(driver, `missing generated claude-code hook driver for ${c.id}`).toBeTruthy();
        if (!driver) throw new Error(`missing generated claude-code hook driver for ${c.id}`);
        const { result: r, lines: logLines, error } = runClaudeUntilExpectedEvent(driver);
        const events = logLines.map((line) => line.event);
        expect(events.length, 'no Claude Code hook events were logged').toBeGreaterThan(0);
        expect(events).toContain(driver.tool ? 'preToolUse' : 'userPromptSubmit');

        if (!EXPECT_LOCAL_RULES) {
          expect(r?.is_error).toBeFalsy();
          return;
        }

        if (c.expectedOutcome === 'deny') {
          // The hook returned block (or halt); claude refused.
          // Either the rule name surfaces in the result text, or
          // the tool ends up on the permission_denials list.
          const denied = r?.permission_denials?.some(
            (d) => d.tool_name === driver.tool,
          );
          const mentionsRule = r?.result.includes(c.expectedRule);
          expect(denied || mentionsRule || logShowsDeniedRule(logLines, c), error?.message).toBe(true);
        } else if (c.expectedOutcome === 'require_approval') {
          // The hook timed out waiting for approval; claude
          // refused the action and surfaced a soft-deny message.
          // The permission_denials entry (when a tool fired) or
          // the result text both signal the require_approval
          // path. We accept either.
          if (driver.tool) {
            const denied = r?.permission_denials?.some(
              (d) => d.tool_name === driver.tool,
            );
            expect(denied || logShowsDeniedRule(logLines, c), error?.message).toBe(true);
          } else {
            // userPromptSubmit-only path; the LLM still produced a
            // result, just gated by the hook. We assert is_error
            // is not set, which covers both timeouts and resolves.
            expect(r?.is_error).toBeFalsy();
          }
        } else {
          // outcome allow; the action proceeded.
          if (error) throw error;
          if (!r) throw new Error('Claude Code host did not return JSON result');
          expect(r.permission_denials ?? []).toEqual([]);
        }
      },
      300_000,
    );
  }
});
