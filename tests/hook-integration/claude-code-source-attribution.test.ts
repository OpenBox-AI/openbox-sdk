// Source attribution for the claude-code runtime adapter.
//
// The SDK's `approvalSource(a)` (in `ts/src/approvals/source.ts`)
// reads `metadata.source` first, then `spans[0].module`, to
// attribute an approval row to its originating host. The SDK
// adapter populates `spans[0].module = 'claude-code'` through
// `buildSpan('claude-code', ...)` in
// `ts/src/governance/spans.ts`; the unit-test for that contract
// lives next to the function it exercises.
//
// What this e2e test asserts is the live round-trip: a real
// claude run reaches the backend, lands as an approval row, and
// the row's activity payload matches what the claude-code
// adapter would have constructed. The activity_type mapping
// (file_read tool -> 'FileRead' activity) is the on-the-wire
// fingerprint of the claude-code adapter; a row with the right
// activity_type and the file_path the user prompted is concrete
// proof the claude-code adapter built and submitted it.
//
// The full `spans[0].module` assertion is verified by the
// approval-source unit tests; the backend's pending-list view
// strips spans for response size, so it cannot be checked here.
//
// Skipped unless OPENBOX_E2E_LIVE=1 and the project-scope test
// workspace is configured.

import { describe, expect, it, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { approvalSource } from '../../ts/src/approvals/source.js';
import { buildSpan } from '../../ts/src/governance/spans.js';
import type { Approval } from '../../ts/src/types/index.js';
import {
  runClaude,
  SHOULD_RUN,
  assertClaudeOnPath,
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
  activity_type?: string;
  input?: unknown;
  created_at?: string;
}

function fetchPending(agentId: string): PendingRow[] {
  // `--limit 200` defeats the default per-page cap so the test
  // can see freshly-created rows that would otherwise land on a
  // later page. The CLI's default pagination is oldest-first, so
  // a newly-created row from this test run is the most-paginated
  // row in the response.
  const r = spawnSync(
    OPENBOX,
    [
      '--env', 'local', '--experimental', '--json',
      'approval', 'pending', agentId,
      '--limit', '200',
    ],
    {
      encoding: 'utf-8',
      timeout: 10_000,
      env: { ...process.env, OPENBOX_EXPERIMENTAL_LEVEL: 'experimental' },
    },
  );
  if (r.status !== 0 || !r.stdout) return [];
  try {
    const parsed = JSON.parse(r.stdout) as PendingRow[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rowKey(row: PendingRow): string | null {
  return row.id ?? null;
}

describe('approvalSource() contract for claude-code spans', () => {
  it('attributes a row to claude-code when spans[0].module is claude-code', () => {
    const span = buildSpan('claude-code', 'file_read', { file_path: '/etc/hostname' });
    const approval = { spans: [span] } as unknown as Approval;
    expect(approvalSource(approval)).toBe('claude-code');
  });

  it('prefers metadata.source over span attribution', () => {
    const span = buildSpan('claude-code', 'file_read', { file_path: '/etc/hostname' });
    const approval = {
      metadata: { source: 'mobile' },
      spans: [span],
    } as unknown as Approval;
    expect(approvalSource(approval)).toBe('mobile');
  });

  it('returns undefined when neither metadata nor spans carry a source', () => {
    expect(approvalSource({} as Approval)).toBeUndefined();
    expect(approvalSource({ spans: [] } as unknown as Approval)).toBeUndefined();
  });
});

describe.runIf(SHOULD_RUN)('claude-code activity round-trip', () => {
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

  it('file_read tool from claude lands as a FileRead activity row', () => {
    expect(agentId).not.toBeNull();
    const aid = agentId!;
    const targetPath = '/etc/hostname';

    const startedAt = new Date();

    runClaude(`Read ${targetPath} using the Read tool`, {
      allowedTool: 'Read',
      timeoutMs: 200_000,
    });

    // The CLI's pending list paginates and orders by oldest-first
    // by default, so comparing IDs against a pre-run snapshot
    // misses new rows that landed on a later page. Compare by
    // `created_at` instead; any row created at or after the test
    // started must be from this run.
    const after = fetchPending(aid);
    const fresh = after.filter((r) => {
      const created = r.created_at ? new Date(r.created_at) : null;
      return created !== null && created.getTime() >= startedAt.getTime();
    });
    expect(fresh.length, 'no new approval row appeared in pending').toBeGreaterThan(0);

    // The claude-code adapter's `activityTypeFor('Read')` maps to
    // `'FileRead'`; the row's `activity_type` carries the result
    // through. A row matching that activity_type with the right
    // file path is on-the-wire evidence the claude adapter built
    // and submitted the payload.
    const fileReadRow = fresh.find((r) => r.activity_type === 'FileRead');
    expect(
      fileReadRow,
      `no FileRead activity row found; activity_types in new rows: ${fresh.map((r) => r.activity_type).join(', ')}`,
    ).toBeDefined();

    // The row's input array carries the file_path that was
    // queried. Find any item with file_path === targetPath.
    const input = (fileReadRow!.input ?? []) as Array<Record<string, unknown>>;
    const match = input.find((entry) => entry.file_path === targetPath);
    expect(
      match,
      `expected file_path=${targetPath} in row.input but got ${JSON.stringify(input).slice(0, 200)}`,
    ).toBeDefined();
  }, 240_000);
});
