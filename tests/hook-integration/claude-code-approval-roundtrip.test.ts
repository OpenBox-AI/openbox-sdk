// Approval lifecycle round-trip for the claude-code runtime
// adapter. Same shape as the cursor wdio suite's "verdict 2 →
// pending → decide → history" describe block, but driven through
// the real claude CLI instead of the extension's diag commands.
//
// Step 1: spawn `claude -p ...` with a prompt that triggers an
//         e2e-approve-* rule (require_approval). Run it in the
//         background; the hook subprocess inside claude will block
//         on the SDK's approval polling.
//
// Step 2: while claude blocks, poll approvals through backend API/MCP
//         until the new row shows up.
//
// Step 3: decide the approval through the Backend approval API.
//         The SDK polling loop inside claude picks up the resolved
//         row, returns allow, and claude proceeds.
//
// Step 4: assert claude's final JSON envelope shows the action
//         completed (no permission_denials, is_error falsy).
//
// Skipped unless OPENBOX_E2E_LIVE=1, the project-scope test
// workspace is configured, and the agent id is known.

import { describe, expect, it, beforeAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  WORKSPACE,
  SHOULD_RUN,
  assertClaudeOnPath,
  type ClaudeResult,
} from './helpers/claude-runner.js';

const OPENBOX = process.env.OPENBOX_CLI ?? 'openbox';
const E2E_AGENT_NAME = 'e2e-agent';

function resolveAgentId(): string | null {
  if (process.env.OPENBOX_E2E_AGENT_ID) return process.env.OPENBOX_E2E_AGENT_ID;
  const keysFile = path.join(os.homedir(), '.openbox', 'agent-keys');
  if (!existsSync(keysFile)) return null;
  try {
    const cache = JSON.parse(readFileSync(keysFile, 'utf-8')) as Record<
      string,
      { agentId: string; agentName: string }
    >;
    return Object.values(cache).find((r) => r.agentName === E2E_AGENT_NAME)?.agentId ?? null;
  } catch {
    return null;
  }
}

interface PendingRow {
  id?: string;
  event_id?: string;
  agent_id?: string;
  approval_id?: string;
}

function fetchPending(agentId: string): PendingRow[] {
  // Spec-driven `approval pending <agentId>` returns a list. The
  // CLI emits JSON when `--json` is set globally. `--limit 200`
  // overrides the default per-page cap so the new row from this
  // test run is visible (default pagination is oldest-first; a
  // fresh row lands on a later page). Failure is common during
  // the gap between the hook entering the polling loop and the
  // backend row being visible; the caller retries.
  const r = spawnSync(
    OPENBOX,
    [
      '--experimental', '--json',
      'approval', 'pending', agentId,
      '--limit', '200',
    ],
    {
      encoding: 'utf-8',
      timeout: 10_000,
      env: {
        ...process.env,
        OPENBOX_EXPERIMENTAL_LEVEL: 'experimental',
      },
    },
  );
  if (r.status !== 0 || !r.stdout) return [];
  try {
    const parsed = JSON.parse(r.stdout) as
      | PendingRow[]
      | { data?: PendingRow[]; items?: PendingRow[]; pending?: PendingRow[] };
    if (Array.isArray(parsed)) return parsed;
    return parsed.data ?? parsed.items ?? parsed.pending ?? [];
  } catch {
    return [];
  }
}

function rowKey(row: PendingRow): string | null {
  return row.event_id ?? row.id ?? row.approval_id ?? null;
}

function decide(agentId: string, eventId: string, action: 'approve' | 'reject'): boolean {
  const r = spawnSync(
    OPENBOX,
    ['--experimental', 'approval', 'decide', agentId, eventId, action],
    {
      encoding: 'utf-8',
      timeout: 10_000,
      env: {
        ...process.env,
        OPENBOX_EXPERIMENTAL_LEVEL: 'experimental',
      },
    },
  );
  return r.status === 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe.runIf(SHOULD_RUN)('claude-code approval round-trip', () => {
  let agentId: string | null = null;

  beforeAll(() => {
    assertClaudeOnPath();
    agentId = resolveAgentId();
    if (!agentId) {
      throw new Error(
        `cannot resolve ${E2E_AGENT_NAME} id; set OPENBOX_E2E_AGENT_ID or ` +
          'run openbox-local bootstrap first',
      );
    }
  });

  it('require_approval row → approve via CLI → claude proceeds', async () => {
    expect(agentId).not.toBeNull();
    const aid = agentId!;

    // Snapshot the existing IDs so we can spot rows this run creates.
    const before = new Set(fetchPending(aid).map(rowKey).filter(Boolean) as string[]);

    // Spawn claude in the background; multiple hooks (userPromptSubmit
    // and preToolUse) each create their own require_approval row, so
    // the watcher below approves every new row it sees until claude
    // exits. HITL_MAX_WAIT is shortened so the SDK does not keep
    // polling past the test's ceiling if the watcher misses a row.
    const child = spawn(
      'claude',
      [
        '-p',
        // file_read against /etc/hostname triggers e2e-approve-read
        // (verdict 2 / require_approval) per the bootstrap manifest.
        // userPromptSubmit also fires e2e-approve-llm, so the
        // watcher approves both rows as they appear.
        'Read /etc/hostname using the Read tool',
        '--output-format',
        'json',
        '--dangerously-skip-permissions',
        '--allowedTools',
        'Read',
      ],
      {
        cwd: WORKSPACE,
        env: { ...process.env, HITL_MAX_WAIT: '60' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString('utf-8')));
    child.stderr.on('data', (b) => (stderr += b.toString('utf-8')));
    const claudeDone = new Promise<number | null>((resolveDone) => {
      child.on('exit', (code) => resolveDone(code));
    });

    // Watcher loop: every second, fetch pending rows and approve
    // any whose id was not in `before`. Stops when claude exits or
    // after ~240 ticks (4 minutes) for safety; either resolves
    // the test path.
    let claudeExited = false;
    let approvedCount = 0;
    claudeDone.then(() => {
      claudeExited = true;
    });

    for (let i = 0; i < 90 && !claudeExited; i++) {
      await sleep(1000);
      for (const row of fetchPending(aid)) {
        const key = rowKey(row);
        if (key && !before.has(key)) {
          if (decide(aid, key, 'approve')) {
            approvedCount += 1;
            before.add(key);
          }
        }
      }
    }

    // Wait the rest of the way for claude to exit (no-op if already done).
    const exitCode = await claudeDone;
    expect(approvedCount, 'no approval rows were created by the run').toBeGreaterThan(0);

    let parsed: ClaudeResult | null = null;
    const start = stdout.indexOf('{');
    if (start >= 0) {
      try {
        parsed = JSON.parse(stdout.slice(start)) as ClaudeResult;
      } catch {
        /* fall through */
      }
    }
    expect(
      parsed,
      `failed to parse claude JSON; exit=${exitCode} stdout=${stdout.slice(0, 200)} stderr=${stderr.slice(0, 200)}`,
    ).not.toBeNull();
    // After approves, the action should proceed: no permission_denials.
    expect(parsed!.permission_denials ?? []).toEqual([]);
    expect(parsed!.is_error).toBeFalsy();
  }, 120_000);
});
