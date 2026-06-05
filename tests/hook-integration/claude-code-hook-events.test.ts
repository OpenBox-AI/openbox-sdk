// Hook event coverage for the claude-code runtime adapter.
//
// One claude session emits a fixed sequence of hook events:
// sessionStart, userPromptSubmit, preToolUse, postToolUse, stop,
// sessionEnd. Each one is dispatched through `logged()` in
// `runtime/claude-code/hook-handler.ts`, which appends a JSONL
// entry to `~/.openbox/log/claude-code-hook.jsonl`.
//
// This test snapshots the log size before the session, runs one
// allowed action (so no event short-circuits on a deny), then
// asserts every expected event appeared in the appended slice
// with sane took_ms bounds and no error string.
//
// Skipped unless `OPENBOX_E2E_LIVE=1` and the project-scope test
// workspace is configured. See claude-code-headless.test.ts for
// the workspace prerequisites.

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
// The events we care about are the ones the runtime adapter logs
// regardless of verdict: sessionStart, userPromptSubmit,
// preToolUse / postToolUse if a tool fires, stop, sessionEnd.

const REQUIRED_EVENTS = ['sessionStart', 'userPromptSubmit', 'stop', 'sessionEnd'];

describe.runIf(SHOULD_RUN)('claude-code hook events', () => {
  beforeAll(() => {
    assertClaudeOnPath();
  });

  it('one session emits every adapter hook event to the JSONL log', () => {
    const offset = snapshotHookLog();
    runClaude('What is 2 plus 2? Answer with just the number.', {
      // No tool allowance; the prompt is benign so claude answers
      // from the model without firing pre/postToolUse. Even so the
      // userPromptSubmit rule (e2e-approve-llm) triggers require_approval
      // and the SDK eventually times out, which still produces all the
      // session-lifecycle events.
      allowedTool: '',
      timeoutMs: 45_000,
    });
    const lines = hookLogSince(offset);
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
  }, 60_000);

  it('preToolUse fires when claude invokes a tool', () => {
    const offset = snapshotHookLog();
    // Bash + `echo` triggers the e2e-deny-shell rule. claude
    // typically retries a denied tool a few times before giving
    // up, which is why the timeout matches the headless matrix
    // ceiling rather than the short block-verdict roundtrip.
    runClaude('Run shell: echo hook-event-test', {
      allowedTool: 'Bash',
      timeoutMs: 45_000,
    });
    const events = hookLogSince(offset).map((l) => l.event);
    expect(events).toContain('preToolUse');
    // postToolUse only fires on the allow path, so we do not
    // require it here; preToolUse plus the eventual deny is
    // enough to prove the tool-attempt hook fired.
  }, 60_000);
});
