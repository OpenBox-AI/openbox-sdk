// Subagent hook coverage for the claude-code runtime adapter.
//
// SubagentStart / SubagentStop dispatch through their own mappers
// (ts/src/runtime/claude-code/mappers/subagent.ts), open and
// close per-subagent activities, and log to the JSONL hook log.
// Forcing claude -p to spawn a real Task subagent is unreliable
// (model decides whether to delegate), so this test drives the
// hook subprocess directly with synthetic envelopes and asserts
// the activity_type fingerprint + the log entries.

import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  runClaude,
  snapshotHookLog,
  hookLogSince,
  SHOULD_RUN as LIVE_SHOULD_RUN,
  assertClaudeOnPath,
} from './helpers/claude-runner.js';
import { requireOpenBoxCli } from '../helpers/openbox-cli.js';

const OPENBOX = requireOpenBoxCli();

function planConfigDir(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'obx-cc-subagent-'));
  const dir = path.join(root, '.openbox', 'claude-code');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({
      governanceTimeout: 1,
      hitlEnabled: false,
    }),
  );
  const settingsLocal = path.join(root, '.claude', 'settings.local.json');
  mkdirSync(path.dirname(settingsLocal), { recursive: true });
  writeFileSync(
    settingsLocal,
    JSON.stringify({
      env: {
        OPENBOX_API_KEY: 'obx_test_0000000000000000000000000000000000000000000000',
        OPENBOX_CORE_URL: 'http://127.0.0.1:1',
      },
    }),
  );
  return root;
}

function callHook(envelope: Record<string, unknown>, cwd: string): {
  status: number | null; stdout: string; stderr: string;
} {
  const r = spawnSync(OPENBOX, ['claude-code', 'hook'], {
    cwd,
    encoding: 'utf-8',
    timeout: 10_000,
    input: JSON.stringify(envelope),
    env: { ...process.env },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('claude-code subagent events', () => {
  it('SubagentStart and SubagentStop dispatch and log a record each', () => {
    const root = planConfigDir();
    const logPath = path.join(root, '.openbox', 'claude-code', 'log', 'claude-code-hook.jsonl');
    const before = existsSync(logPath) ? readFileSync(logPath, 'utf-8').length : 0;

    const baseEnv = {
      session_id: 's-sub-1',
      agent_id: 'a-sub',
      agent_type: 'task',
    };

    const start = callHook({ hook_event_name: 'SubagentStart', ...baseEnv }, root);
    expect(start.status, `SubagentStart failed: ${start.stderr}`).toBe(0);

    const stop = callHook({ hook_event_name: 'SubagentStop', ...baseEnv }, root);
    expect(stop.status, `SubagentStop failed: ${stop.stderr}`).toBe(0);

    const appended = readFileSync(logPath, 'utf-8').slice(before);
    const lines = appended
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as { event: string; verdict_kind?: string; error?: string | null });

    expect(lines.some((l) => l.event === 'subagentStart')).toBe(true);
    expect(lines.some((l) => l.event === 'subagentStop')).toBe(true);
    for (const line of lines) {
      expect(line.error ?? null).toBeNull();
    }
  });

  it('SubagentStart returns no-decision stdout (observe-only event)', () => {
    const root = planConfigDir();
    const r = callHook(
      { hook_event_name: 'SubagentStart', session_id: 's-sub-2', agent_id: 'a-sub-2' },
      root,
    );
    expect(r.status).toBe(0);
    // SubagentStart uses the no-decision verdict shape: the
    // adapter writes empty stdout (or a passthrough decision-block
    // shape) since claude does not gate on it.
    const text = r.stdout.trim();
    if (text.length > 0) {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      expect(parsed.decision).toBeUndefined();
    }
  });
});

describe.runIf(LIVE_SHOULD_RUN)('real subagent spawn through claude Agent tool', () => {
  beforeAll(() => {
    assertClaudeOnPath();
  });

  it('Agent delegation host events are logged without adapter errors', () => {
    let lines: ReturnType<typeof hookLogSince> = [];
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const offset = snapshotHookLog();
      // Prompt explicitly asks claude to delegate. The Agent tool
      // spawns a subagent which fires SubagentStart through the
      // hook subprocess. The model occasionally decides to do the
      // work inline instead, so we accept either outcome and only
      // assert the event when the tool ran.
      try {
        runClaude(
          'Call the Agent tool exactly once. Delegate to an agent with the task: return the literal string OK. Do not answer inline before using the tool.',
          {
            allowedTool: 'Agent',
            tools: 'Agent',
            timeoutMs: Number(process.env.OPENBOX_CLAUDE_SUBAGENT_TIMEOUT_MS ?? 240_000),
          },
        );
        lastError = undefined;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }

      lines = hookLogSince(offset);
      if (lines.some((l) => (
        l.event === 'subagentStart' ||
        l.event === 'preToolUse' ||
        l.event === 'stop'
      ))) break;
    }
    const sawSubagent = lines.some((l) => l.event === 'subagentStart' || l.event === 'subagentStop');
    expect(lines.length, lastError?.message ?? 'no Claude Code hook events were logged').toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.error ?? null).toBeNull();
    }

    // When claude chose to delegate, the subagent hooks fired. When
    // it answered inline, no subagent event appears; that path is
    // not a regression (we cannot force the model). We assert that
    // EITHER the subagent events landed OR the host ran through the
    // official hook path without adapter errors. Set
    // OPENBOX_CLAUDE_SUBAGENT_STRICT=1 when manually validating that
    // the live model delegated through Agent in this environment.
    if (sawSubagent) {
      expect(
        lines.some((l) => l.event === 'subagentStart'),
        'subagentStop appeared without subagentStart',
      ).toBe(true);
    } else if (process.env.OPENBOX_CLAUDE_SUBAGENT_STRICT === '1') {
      throw lastError ?? new Error('Claude Code did not delegate through Agent');
    } else {
      expect(
        lines.some((l) => ['sessionStart', 'userPromptSubmit', 'preToolUse', 'stop'].includes(l.event)),
        lastError?.message,
      ).toBe(true);
    }
  }, 300_000);
});
