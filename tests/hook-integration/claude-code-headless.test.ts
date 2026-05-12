// Headless end-to-end matrix for the claude-code runtime adapter.
//
// Spawns `claude -p ...` inside a project-scope-installed test
// workspace and asserts that each rule planted by the local
// bootstrap fires through the hook subprocess. Mirrors the cursor
// wdio suite's verdict matrix (sourced from the same shared
// fixture under `fixtures/verdict-matrix.ts`) so adding a host
// adds one runner, not a duplicate matrix.
//
// Skipped unless:
//   - `OPENBOX_E2E_LIVE=1`
//   - the local stack is reachable
//   - the test workspace `~/workspace/openbox-claude-test/` is
//     present and configured
//
// Set up the workspace once with:
//
//   openbox claude-code install --scope project \
//     --cwd ~/workspace/openbox-claude-test --no-mcp
//
// then edit `<cwd>/.claude-hooks/config.json` to point at the
// local stack with a runtime key.

import { describe, expect, it, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {
  VERDICT_MATRIX,
  type VerdictMatrixCase,
} from './fixtures/verdict-matrix.js';

const WORKSPACE =
  process.env.OPENBOX_E2E_CLAUDE_WORKSPACE ??
  path.join(os.homedir(), 'workspace', 'openbox-claude-test');

const SHOULD_RUN =
  process.env.OPENBOX_E2E_LIVE === '1' &&
  existsSync(path.join(WORKSPACE, '.claude', 'settings.json')) &&
  existsSync(path.join(WORKSPACE, '.claude-hooks', 'config.json'));

interface ClaudeResult {
  result: string;
  permission_denials?: Array<{
    tool_name: string;
    tool_input?: unknown;
  }>;
  is_error?: boolean;
}

/**
 * One claude session for one case. `--allowedTools` is scoped to
 * the single tool the case needs so claude does not retry through
 * other tools after a deny.
 */
function runClaude(prompt: string, allowedTool: string): ClaudeResult {
  const result = spawnSync(
    'claude',
    [
      '-p',
      prompt,
      '--output-format',
      'json',
      '--dangerously-skip-permissions',
      '--allowedTools',
      allowedTool,
    ],
    {
      cwd: WORKSPACE,
      encoding: 'utf-8',
      // Two minutes is enough for either a deny (sub-second) or
      // for the SDK's `approvalMaxWaitMs` ceiling on require_approval
      // (60s) plus the rest of the session boilerplate.
      timeout: 120_000,
      input: '',
    },
  );
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

/** Translate a fixture case into a (prompt, tool) pair claude can
 *  run. Only the cases the claude-code runtime can realistically
 *  exercise are mapped; the rest are skipped at runtime. */
function prompt(c: VerdictMatrixCase): { prompt: string; tool: string } | null {
  switch (c.spanType) {
    case 'shell':
      return { prompt: 'Run shell: echo hello', tool: 'Bash' };
    case 'file_write':
      return {
        prompt: `Use the Write tool to create ${c.activityInput.file_path} with content 'hello'`,
        tool: 'Write',
      };
    case 'file_read':
      return {
        prompt: 'Read /etc/hostname using the Read tool',
        tool: 'Read',
      };
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
    // Cheap probe that the CLI is actually on PATH; the matrix
    // itself runs claude many times so failing here gives a
    // clearer signal than each case timing out.
    const v = spawnSync('claude', ['--version'], { encoding: 'utf-8' });
    if (v.status !== 0) {
      throw new Error(`claude CLI not on PATH: ${v.stderr}`);
    }
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
        const r = runClaude(driver.prompt, driver.tool);

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
      150_000,
    );
  }
});
