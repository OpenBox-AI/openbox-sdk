// Cursor fires `preToolUse` AND a specialized `before*` event for one
// logical tool invocation. Without coordination, both mappers fire
// session.activity → two backend approval rows → two toasts → orphan
// rows when the extension auto-dismisses one toast.
//
// The dedup helper (ts/src/runtime/cursor/dedup.ts) serializes via
// an atomic filesystem claim. This test pins that contract end-to-end:
//
//   1. Two simulated mappers run for the same logical action.
//   2. Only one wins the claim and fires session.activity.
//   3. The other returns undefined (Cursor: proceed).
//
// Also covers: the subagent-first-call case where only the specialized
// event fires (preToolUse missed); the specialized handler still gates.
//
// And: the FileDelete reroute living in beforeShellExecution now, so
// a subagent's first `rm` still classifies correctly when preToolUse
// doesn't fire.

import { describe, expect, test, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { handleBeforeShellExecution } from '../../ts/src/runtime/cursor/mappers/shell.ts';
import { handleBeforeReadFile } from '../../ts/src/runtime/cursor/mappers/file-read.ts';
import { handlePreToolUse } from '../../ts/src/runtime/cursor/mappers/pre-tool-use.ts';
import {
  buildActionKey,
  claimAction,
  awaitClaimDecision,
  publishClaimDecision,
  isFileDeleteCommand,
} from '../../ts/src/runtime/cursor/dedup.ts';

const DEDUP_DIR = path.join(os.homedir(), '.openbox', 'run', 'dedup');

interface ActivityCall {
  eventType: string;
  activityType: string;
}

function makeCapturingSession(captured: ActivityCall[]) {
  return {
    activity: async (eventType: string, activityType: string) => {
      captured.push({ eventType, activityType });
      return { arm: 'allow' as const, decision: { decisionId: 'd' } };
    },
    workflowStarted: async () => undefined,
    workflowCompleted: async () => undefined,
  };
}

// hitlMaxWait drives the loser's await deadline; keep small so the
// timeout-path test doesn't slow the suite. Tests that exercise the
// happy path complete in <200ms because the winner runs synchronously.
const cfg = { idleTimeoutMs: 60_000, sessionStorePath: '', hitlMaxWait: 2 } as never;

function uniqueGenId(): string {
  return `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function clearLockForKey(key: string): void {
  try { fs.unlinkSync(path.join(DEDUP_DIR, key)); } catch { /* ignore */ }
}

describe('per-action dedup across hook subprocesses', () => {
  beforeEach(() => {
    // Cleanly drop any leftover lock from previous tests in the same
    // file (the runner shares the home dir).
    try {
      for (const f of fs.readdirSync(DEDUP_DIR)) {
        if (f.length === 16) fs.unlinkSync(path.join(DEDUP_DIR, f));
      }
    } catch { /* dir may not exist yet */ }
  });

  test('claimAction: first caller wins, subsequent callers lose', () => {
    const key = buildActionKey({
      generation_id: uniqueGenId(),
      kind: 'shell',
      arg: 'ls /tmp',
    });
    const a = claimAction(key);
    const b = claimAction(key);
    const c = claimAction(key);
    expect(a.won).toBe(true);
    expect(b.won).toBe(false);
    expect(c.won).toBe(false);
  });

  test('claimAction: different keys do not collide', () => {
    const key1 = buildActionKey({ generation_id: 'g1', kind: 'shell', arg: 'ls' });
    const key2 = buildActionKey({ generation_id: 'g1', kind: 'shell', arg: 'pwd' });
    expect(claimAction(key1).won).toBe(true);
    expect(claimAction(key2).won).toBe(true);
  });

  test('preToolUse runs the gate; beforeShellExecution waits and mirrors the verdict', async () => {
    const generation_id = uniqueGenId();
    const command = 'echo dedup-test';
    const captured: ActivityCall[] = [];

    // preToolUse fires first (Cursor's typical pattern): wins claim,
    // calls session.activity (allow), publishes decision to lock.
    await handlePreToolUse(
      {
        conversation_id: 'c',
        generation_id,
        tool_name: 'Shell',
        tool_input: { command },
      } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    // beforeShellExecution fires second: loses claim, reads the
    // published decision, returns matching verdict without calling
    // session.activity again.
    await handleBeforeShellExecution(
      { conversation_id: 'c', generation_id, command } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );

    expect(captured).toHaveLength(1);
    expect(captured[0].activityType).toBe('ShellExecution');
  });

  test('loser blocks until winner publishes, then mirrors the verdict', async () => {
    const generation_id = uniqueGenId();
    const command = 'echo race-test';
    const captured: ActivityCall[] = [];
    // Winner whose session.activity stalls until we explicitly resolve.
    let resolveActivity: (v: { arm: 'block'; reason: string }) => void = () => {};
    const winnerSession = {
      activity: async (eventType: string, activityType: string) => {
        captured.push({ eventType, activityType });
        return await new Promise((res) => { resolveActivity = res as never; });
      },
      workflowStarted: async () => undefined,
      workflowCompleted: async () => undefined,
    };

    // Kick off both handlers concurrently. preToolUse wins (called
    // first); beforeShellExecution loses and awaits the decision.
    const winnerP = handlePreToolUse(
      {
        conversation_id: 'c',
        generation_id,
        tool_name: 'Shell',
        tool_input: { command },
      } as never,
      winnerSession as never,
      cfg,
    );
    // Tiny tick so winner's claim lands first.
    await new Promise((r) => setTimeout(r, 10));
    const loserP = handleBeforeShellExecution(
      { conversation_id: 'c', generation_id, command } as never,
      makeCapturingSession([]) as never, // shouldn't be used
      cfg,
    );

    // Loser should still be waiting; resolve the winner's gate as
    // block. Both should then return block-shaped verdicts.
    await new Promise((r) => setTimeout(r, 250));
    resolveActivity({ arm: 'block', reason: 'denied by policy' });

    const [w, l] = await Promise.all([winnerP, loserP]);
    expect(w?.arm).toBe('block');
    expect(l?.arm).toBe('block');
    expect(l?.reason).toBe('denied by policy');
    expect(captured).toHaveLength(1); // only winner emitted activity
  });

  test('published lock is unlinked after grace window so re-issues gate freshly', async () => {
    const generation_id = uniqueGenId();
    const command = 'echo cleanup-test';
    const captured: ActivityCall[] = [];

    // Turn 1: gates, approves, publishes decision.
    await handleBeforeShellExecution(
      { conversation_id: 'c', generation_id, command } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    expect(captured).toHaveLength(1);

    // After PUBLISH_GRACE_MS (800), the lock should be gone. Wait
    // past that.
    await new Promise((r) => setTimeout(r, 1100));

    // Turn 2: SAME generation_id + command but the lock is gone now,
    // so this should re-gate (winner claim, fresh session.activity).
    await handleBeforeShellExecution(
      { conversation_id: 'c', generation_id, command } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );

    // Two session.activity calls; confirms lock cleanup happened.
    expect(captured).toHaveLength(2);
  });

  test('loser fails open if winner never publishes (deadline elapses)', async () => {
    const generation_id = uniqueGenId();
    const command = 'echo orphan-claim';
    // Hand-write a lock with no decision; simulates a winner that
    // crashed before publishing. The loser should poll until cfg's
    // hitlMaxWait (set to 2s here) and then fail open (undefined).
    const key = buildActionKey({ generation_id, kind: 'shell', arg: command });
    expect(claimAction(key).won).toBe(true);

    const t0 = Date.now();
    const verdict = await handleBeforeShellExecution(
      { conversation_id: 'c', generation_id, command } as never,
      makeCapturingSession([]) as never,
      cfg,
    );
    const elapsed = Date.now() - t0;

    expect(verdict).toBeUndefined(); // fail open
    expect(elapsed).toBeGreaterThanOrEqual(1500); // waited at least
    expect(elapsed).toBeLessThan(4000); // bounded by hitlMaxWait*1000
  });

  test('beforeShellExecution gates when preToolUse never fires (subagent first call)', async () => {
    const generation_id = uniqueGenId();
    const command = 'ls /tmp';
    const captured: ActivityCall[] = [];

    // Skip preToolUse; simulates Cursor's subagent first-tool behavior.
    await handleBeforeShellExecution(
      { conversation_id: 'c', generation_id, command } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );

    expect(captured).toHaveLength(1);
    expect(captured[0].activityType).toBe('ShellExecution');
  });

  test('FileDelete reroute still classifies correctly via beforeShellExecution alone', async () => {
    const generation_id = uniqueGenId();
    const command = 'rm -rf /tmp/test-target';
    const captured: ActivityCall[] = [];

    // Subagent first-call: only beforeShellExecution fires. FileDelete
    // pattern detection now lives here too, mirroring preToolUse's
    // @activityVariant from the spec.
    await handleBeforeShellExecution(
      { conversation_id: 'c', generation_id, command } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );

    expect(captured).toHaveLength(1);
    expect(captured[0].activityType).toBe('FileDelete');
  });

  test('preToolUse + beforeReadFile on same outside-workspace path: only one gates', async () => {
    const generation_id = uniqueGenId();
    const file_path = '/etc/hosts';
    const captured: ActivityCall[] = [];

    await handlePreToolUse(
      {
        conversation_id: 'c',
        generation_id,
        tool_name: 'Read',
        tool_input: { file_path },
        workspace_roots: ['/Users/me/myproject'],
      } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );
    await handleBeforeReadFile(
      {
        conversation_id: 'c',
        generation_id,
        file_path,
        content: 'placeholder',
        workspace_roots: ['/Users/me/myproject'],
      } as never,
      makeCapturingSession(captured) as never,
      cfg,
    );

    expect(captured).toHaveLength(1);
    expect(captured[0].activityType).toBe('FileRead');
  });

  test('isFileDeleteCommand pattern coverage', () => {
    // Matches the spec's @activityVariant pattern \b(rm|unlink|rmdir|
    // shred)\b; \b word boundary is intentionally permissive so a
    // sneaky `rm` inside any compound shell expression still flags
    // as FileDelete. Over-flagging beats under-flagging here.
    expect(isFileDeleteCommand('rm -rf /tmp/x')).toBe(true);
    expect(isFileDeleteCommand('unlink /tmp/y')).toBe(true);
    expect(isFileDeleteCommand('rmdir /tmp/empty')).toBe(true);
    expect(isFileDeleteCommand('shred -u /tmp/secret')).toBe(true);
    // Word boundary catches hyphen-adjacent rm too. This is the
    // spec's intended behavior, not a tightening target.
    expect(isFileDeleteCommand('echo rm-not-the-command')).toBe(true);
    // Genuinely non-rm commands stay clean.
    expect(isFileDeleteCommand('ls /tmp')).toBe(false);
    expect(isFileDeleteCommand('echo armadillo')).toBe(false);
    expect(isFileDeleteCommand('cd /removed-dir')).toBe(false);
    expect(isFileDeleteCommand('')).toBe(false);
    expect(isFileDeleteCommand(undefined)).toBe(false);
  });
});
