// Hook event coverage for the claude-code runtime adapter.
//
// One claude session emits a fixed sequence of hook events:
// sessionStart, userPromptSubmit, preToolUse, postToolUse, stop.
// SessionEnd remains handler-supported but is not installed by default
// because shutdown hooks can be cancelled before network telemetry
// reliably completes. Each default event is dispatched through `logged()` in
// `runtime/claude-code/hook-handler.ts`, which appends a JSONL
// entry to `<project>/.openbox/claude-code/log/claude-code-hook.jsonl`.
//
// This test snapshots the log size before the session, runs one
// allowed action (so no event short-circuits on a deny), then
// asserts every expected event appeared in the appended slice
// with sane took_ms bounds and no error string.
//
// Skipped unless the project-scope plugin test directory is configured
// against a loopback Core. See claude-code-headless.test.ts for the
// project prerequisites.

import { describe, expect, it, beforeAll } from 'vitest';
import {
  runClaude,
  hookLogSince,
  snapshotHookLog,
  SHOULD_RUN,
  assertClaudeOnPath,
} from './helpers/claude-runner.js';

// The bootstrap rule manifest gates Bash/Write/Read with deny or
// require_approval, but `echo` is one of the few prompts likely to
// resolve without firing a rule when no tool is allowed; the prompt
// short-circuits before claude attempts a tool. The userPromptSubmit
// rule (e2e-approve-llm) still triggers, so we accept either the
// soft-deny path or the resolved path.
//
// The events the host emits consistently for a benign print-mode prompt:
// sessionStart and userPromptSubmit. Tool lifecycle is covered by the
// separate preToolUse/postToolUse test below; Stop is covered by the
// deterministic hook-subprocess tests because Claude Code does not
// reliably emit Stop for every no-tool print-mode session.

const REQUIRED_EVENTS = ['sessionStart', 'userPromptSubmit'];
const CASE_FILTER = process.env.OPENBOX_CLAUDE_HOOK_EVENT_CASE;
const CLAUDE_EVENT_TIMEOUT_MS = Number(
  process.env.OPENBOX_CLAUDE_HOOK_EVENT_TIMEOUT_MS ?? 240_000,
);
type RunClaudeOptions = Parameters<typeof runClaude>[1];

function runClaudeAndReadLog(prompt: string, options: RunClaudeOptions = {}) {
  const offset = snapshotHookLog();
  let error: Error | undefined;
  try {
    runClaude(prompt, {
      timeoutMs: CLAUDE_EVENT_TIMEOUT_MS,
      ...options,
    });
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err));
  }
  const lines = hookLogSince(offset);
  if (lines.length === 0 && error) throw error;
  return { lines, error };
}

describe.runIf(SHOULD_RUN)('claude-code hook events', () => {
  beforeAll(() => {
    assertClaudeOnPath();
  });

  it.runIf(!CASE_FILTER || CASE_FILTER === 'tool')('tool request logs host events and validates lifecycle when invoked', () => {
    // Use the plugin status MCP tool so this test proves the host
    // emits PreToolUse for a real tool call without depending on a
    // denied governance path. Deny/block verdicts are covered by the
    // headless governance matrix.
    const toolName = 'mcp__plugin_openbox_openbox__openbox_status';
    const { lines, error } = runClaudeAndReadLog(
      'Call the mcp__plugin_openbox_openbox__openbox_status tool exactly once. Return only the tool response text.',
      {
        allowedTool: toolName,
      },
    );
    const events = lines.map((l) => l.event);
    if (!events.includes('preToolUse')) {
      if (process.env.OPENBOX_CLAUDE_TOOL_EVENT_STRICT === '1') {
        throw error ?? new Error('Claude Code did not invoke the requested MCP tool');
      }
      expect(events).toContain('sessionStart');
      expect(events).toContain('userPromptSubmit');
      for (const line of lines) {
        expect(line.error ?? null).toBeNull();
      }
      return;
    }
    const toolEvents = lines.filter((line) => line.tool_name === toolName);
    expect(
      toolEvents.some((line) => line.event === 'preToolUse'),
      error?.message,
    ).toBe(true);
    expect(
      toolEvents.some((line) => (
        line.event === 'postToolUse' || line.event === 'postToolUseFailure'
      )),
      error?.message,
    ).toBe(true);
  }, 300_000);

  it.runIf(!CASE_FILTER || CASE_FILTER === 'lifecycle')('one session emits session and prompt events to the JSONL log', () => {
    const { lines } = runClaudeAndReadLog('What is 2 plus 2? Answer with just the number.', {
      // No tool allowance; the prompt is benign so claude answers
      // from the model without firing pre/postToolUse. Even so the
      // userPromptSubmit rule (e2e-approve-llm) triggers require_approval
      // and the SDK eventually times out, which still produces all the
      // session-lifecycle events.
      allowedTool: '',
    });
    expect(lines.length).toBeGreaterThan(0);

    const events = lines.map((l) => l.event);
    for (const required of REQUIRED_EVENTS) {
      expect(events).toContain(required);
    }

    // No event should record a thrown error. The hook handler
    // catches its own errors and stamps the `error` field; the
    // runtime is supposed to keep claude moving regardless of
    // backend state. Anything in `error` means the hook wrapper
    // itself threw.
    for (const line of lines) {
      expect(line.error ?? null).toBeNull();
    }

    // Took-ms sanity bound: even with a slow backend, no single
    // hook event should exceed the SDK's approvalMaxWaitMs ceiling
    // by much. 120 seconds is generous enough that flakes pass.
    for (const line of lines) {
      if (typeof line.took_ms === 'number') {
        expect(line.took_ms).toBeLessThan(120_000);
      }
    }
  }, 300_000);
});
