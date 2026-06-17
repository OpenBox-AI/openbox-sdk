// Headless end-to-end matrix for the claude-code runtime adapter.
//
// Spawns `claude -p ...` with the project-scope OpenBox plugin loaded
// through `--plugin-dir` and asserts that each rule planted by the local
// bootstrap fires through the hook subprocess. Mirrors the cursor
// wdio suite's verdict matrix (sourced from the same shared
// fixture under `fixtures/verdict-matrix.ts`) so adding a host
// adds one runner, not a duplicate matrix.
//
// Skipped unless:
//   - `OPENBOX_E2E_LIVE=1`
//   - the local stack is reachable
//   - the test workspace `~/workspace/openbox-claude-test/` contains
//     `.claude/skills/openbox` and `.claude-hooks/config.json`
//
// Set up the workspace once with:
//
//   openbox claude-code plugin install --scope project \
//     --cwd ~/workspace/openbox-claude-test
//
// then edit `<cwd>/.claude-hooks/config.json` to point at the
// target Core with a runtime key. The helper passes `OPENBOX_CLI`
// to this checkout's `dist/cli/index.js`, so no global `openbox`
// command is required.

import { describe, expect, it, beforeAll } from 'vitest';
import {
  VERDICT_MATRIX,
  type VerdictMatrixCase,
} from './fixtures/verdict-matrix.js';
import {
  runClaude,
  SHOULD_RUN,
  assertClaudeOnPath,
} from './helpers/claude-runner.js';

/** Translate a fixture case into a (prompt, tool) pair claude can
 *  run. Only the cases the claude-code runtime can realistically
 *  exercise are mapped; the rest are skipped at runtime. */
function prompt(c: VerdictMatrixCase): { prompt: string; tool: string } | null {
  switch (c.spanType) {
    case 'shell':
      return { prompt: 'Use the Bash tool to run exactly: echo hello', tool: 'Bash' };
    case 'file_write':
      const writePath = `/tmp/openbox-claude-write-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`;
      return {
        prompt: `Use only the Write tool to create the new file ${writePath} with content 'hello'. The file does not exist; do not read it first.`,
        tool: 'Write',
      };
    case 'file_read':
      return {
        prompt: 'Read /etc/hostname using the Read tool',
        tool: 'Read',
      };
    case 'http': {
      const url = typeof c.activityInput.url === 'string'
        ? c.activityInput.url
        : 'https://example.com/blocked';
      return {
        prompt: `Use only the WebFetch tool to fetch ${url}. Do not use Bash or WebSearch.`,
        tool: 'WebFetch',
      };
    }
    case 'llm':
      // The userPromptSubmit hook fires on every prompt, so any
      // benign prompt exercises the llm rule. No tool is needed.
      return { prompt: 'What is 2 plus 2?', tool: '' };
    default:
      return null;
  }
}

describe.runIf(SHOULD_RUN)('claude-code headless host matrix', () => {
  beforeAll(() => {
    assertClaudeOnPath();
  });

  for (const c of VERDICT_MATRIX) {
    const driver = prompt(c);
    const skipReason = driver
      ? null
      : `spanType ${c.spanType} has no claude-code tool mapping`;

    (skipReason ? it.skip : it)(
      `${c.name}${skipReason ? ` (${skipReason})` : ''}`,
      () => {
        if (!driver) return;
        const r = runClaude(driver.prompt, { allowedTool: driver.tool });

        if (c.expectedOutcome === 'deny') {
          // The hook returned block (or halt); claude refused.
          // Either the rule name surfaces in the result text, or
          // the tool ends up on the permission_denials list.
          const denied = r.permission_denials?.some(
            (d) => d.tool_name === driver.tool,
          );
          const mentionsRule = r.result.includes(c.expectedRule);
          expect(denied || mentionsRule).toBe(true);
        } else if (c.expectedOutcome === 'require_approval') {
          // The hook timed out waiting for approval; claude
          // refused the action and surfaced a soft-deny message.
          // The permission_denials entry (when a tool fired) or
          // the result text both signal the require_approval
          // path. We accept either.
          if (driver.tool) {
            const denied = r.permission_denials?.some(
              (d) => d.tool_name === driver.tool,
            );
            expect(denied).toBe(true);
          } else {
            // userPromptSubmit-only path; the LLM still produced a
            // result, just gated by the hook. We assert is_error
            // is not set, which covers both timeouts and resolves.
            expect(r.is_error).toBeFalsy();
          }
        } else {
          // outcome allow; the action proceeded.
          expect(r.permission_denials ?? []).toEqual([]);
        }
      },
      60_000,
    );
  }
});
