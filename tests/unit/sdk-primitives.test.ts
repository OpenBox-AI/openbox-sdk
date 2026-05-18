// Coverage for ts/src/{governance,session,logging,install,approvals}/*; pure primitives the
// claude-code/cursor adapters compose against. Each helper is small
// and deterministic; tests use the real fs (in a temp dir) rather
// than mocking it, so the file-mode contract from O.1 also stays
// exercised.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'openbox-runtime-shared-'));
});
afterEach(() => {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

describe('governance/skip-patterns', () => {
  it('SKIP_PATTERNS hides editor + secret + dependency dirs', async () => {
    const { SKIP_PATTERNS } = await import('../../ts/src/governance/skip-patterns');
    const cases: [string, boolean][] = [
      ['/foo/.cursor/settings.json', true],
      ['/foo/.claude/anything', true],
      ['/foo/node_modules/x.js', true],
      ['/foo/.git/HEAD', true],
      ['/Users/me/source/main.ts', false],
    ];
    for (const [p, expected] of cases) {
      const matched = SKIP_PATTERNS.some((re) => re.test(p));
      expect(matched, `${p} → expected matched=${expected}`).toBe(expected);
    }
  });
});

describe('session/store', () => {
  it('save() writes 0o600 file; load round-trips; delete removes', async () => {
    const { SessionStore } = await import('../../ts/src/session/store');
    const s = new SessionStore(dir);
    s.save('abc/123', { hello: 'world' });
    // sanitization: '/' replaced
    expect(existsSync(join(dir, 'abc_123.json'))).toBe(true);
    expect(s.load('abc/123')).toEqual({ hello: 'world' });
    s.delete('abc/123');
    expect(s.load('abc/123')).toBeNull();
  });

  it('cleanup() removes stale sessions older than maxAgeMs', async () => {
    const { SessionStore } = await import('../../ts/src/session/store');
    const s = new SessionStore(dir);
    s.save('keep', { x: 1 });
    s.save('drop', { x: 2 });
    // Age the 'drop' file by changing its mtime far in the past.
    const fs = await import('node:fs');
    const past = new Date(Date.now() - 1000 * 60 * 60 * 24 * 7); // 7d
    fs.utimesSync(join(dir, 'drop.json'), past, past);
    s.cleanup(1000); // anything > 1s old gets pruned
    expect(s.load('keep')).toBeTruthy();
    expect(s.load('drop')).toBeNull();
  });

  it('load() on missing key returns null without throwing', async () => {
    const { SessionStore } = await import('../../ts/src/session/store');
    const s = new SessionStore(dir);
    expect(s.load('nope')).toBeNull();
  });
});

describe('session/resolver', () => {
  it('resolveSessionByKey creates new IDs on first call, reuses on second', async () => {
    const mod = await import('../../ts/src/session/resolver');
    const cfg = { sessionDir: dir };
    const a = mod.resolveSessionByKey('S1', cfg);
    expect(a.workflowId).toMatch(/[0-9a-f-]{36}/);
    expect(a.runId).toMatch(/[0-9a-f-]{36}/);
    const b = mod.resolveSessionByKey('S1', cfg);
    expect(b.workflowId).toBe(a.workflowId);
    expect(b.runId).toBe(a.runId);
  });

  it('markHaltedByKey + clearSessionByKey mutate persisted state', async () => {
    const mod = await import('../../ts/src/session/resolver');
    const cfg = { sessionDir: dir };
    mod.resolveSessionByKey('S2', cfg);
    mod.markHaltedByKey('S2', cfg);
    mod.clearSessionByKey('S2', cfg);
    // After clear, resolving again creates fresh IDs.
    const fresh = mod.resolveSessionByKey('S2', cfg);
    expect(fresh.workflowId).toBeDefined();
  });
});

describe('logging/logger', () => {
  it('createLogger returns init+log; log writes a JSON line to stderr + file', async () => {
    const { createLogger } = await import('../../ts/src/logging/logger');
    const { initLogger, log } = createLogger('test');
    const logFile = join(dir, 'log.jsonl');
    initLogger({ logFile });

    const sink: string[] = [];
    const orig = console.error;
    console.error = (...a: any[]) => sink.push(a.join(' '));
    try {
      log('TestEvent', { foo: 1, big: 'x'.repeat(300) }, { decision: 'allow' });
    } finally {
      console.error = orig;
    }
    expect(sink.some((s) => s.includes('TestEvent'))).toBe(true);
    // The summarize() truncation branch (>200 chars) must trigger.
    expect(sink.some((s) => s.includes('... ('))).toBe(true);
    expect(readFileSync(logFile, 'utf-8')).toContain('TestEvent');
  });

  it('initLogger with logFile=null is a no-op (no FS writes)', async () => {
    const { createLogger } = await import('../../ts/src/logging/logger');
    const { initLogger, log } = createLogger('null-test');
    initLogger({ logFile: null });
    const orig = console.error;
    console.error = () => {};
    try {
      log('NoFile', { x: 1 });
    } finally {
      console.error = orig;
    }
  });
});

describe('install/from-spec', () => {
  it('installAdapter (claude-array) writes the configured key into the target file', async () => {
    const { installAdapter, uninstallAdapter } = await import('../../ts/src/install/from-spec');
    const target = join(dir, 'settings.json');
    const spec = {
      file: target,
      key: 'hooks',
      style: 'claude-array' as const,
      command: 'openbox claude-code hook',
      configDir: dir,
      events: [{ name: 'PreToolUse' }],
    };
    installAdapter(spec);
    expect(existsSync(target)).toBe(true);
    const json = JSON.parse(readFileSync(target, 'utf-8'));
    expect(json.hooks).toBeDefined();
    expect(JSON.stringify(json.hooks)).toContain('openbox claude-code hook');

    uninstallAdapter(spec);
    const after = JSON.parse(readFileSync(target, 'utf-8'));
    const hooksAfter = after.hooks ?? {};
    expect(JSON.stringify(hooksAfter)).not.toContain('openbox claude-code hook');
  });

  it('installAdapter (cursor-keyed) writes per-event entries', async () => {
    const { installAdapter } = await import('../../ts/src/install/from-spec');
    const target = join(dir, 'hooks.json');
    const spec = {
      file: target,
      key: 'hooks',
      style: 'cursor-keyed' as const,
      command: 'openbox cursor hook',
      configDir: dir,
      events: [{ name: 'beforeShellExecution' }, { name: 'afterFileEdit' }],
    };
    installAdapter(spec);
    const json = JSON.parse(readFileSync(target, 'utf-8'));
    expect(json.hooks).toBeDefined();
    const flat = JSON.stringify(json.hooks);
    expect(flat).toContain('beforeShellExecution');
    expect(flat).toContain('openbox cursor hook');
  });
});

describe('approvals/resolve', () => {
  function approvalClient(overrides: Record<string, unknown> = {}) {
    return {
      getProfile: vi.fn(async () => ({ orgId: 'org-1' })),
      getOrgApprovals: vi.fn(async () => ({
        approvals: {
          data: [
            {
              id: 'approval-row-id',
              event_id: 'authoritative-event-id',
              agent_id: 'agent-from-backend',
            },
          ],
        },
      })),
      decideApproval: vi.fn(async () => undefined),
      ...overrides,
    } as any;
  }

  it('uses the backend event_id even when the caller already has an agent id', async () => {
    const { decideApproval } = await import('../../ts/src/approvals/resolve');
    const client = approvalClient();

    const identity = await decideApproval(
      client,
      {
        governanceEventId: 'approval-row-id',
        agentId: 'agent-from-ui',
      },
      'approve',
    );

    expect(client.getOrgApprovals).toHaveBeenCalledWith('org-1', {
      status: 'pending',
      page: 0,
      perPage: 100,
    });
    expect(client.decideApproval).toHaveBeenCalledWith(
      'agent-from-ui',
      'authoritative-event-id',
      { action: 'approve' },
    );
    expect(identity).toEqual({
      agentId: 'agent-from-ui',
      eventId: 'authoritative-event-id',
    });
  });

  it('resolves the agent id and event id from the backend pending row', async () => {
    const { resolveApprovalIdentity } = await import('../../ts/src/approvals/resolve');
    const client = approvalClient();

    await expect(
      resolveApprovalIdentity(client, { governanceEventId: 'approval-row-id' }),
    ).resolves.toEqual({
      agentId: 'agent-from-backend',
      eventId: 'authoritative-event-id',
    });
  });

  it('pages through pending approvals until it finds the matching row', async () => {
    const { decideApproval } = await import('../../ts/src/approvals/resolve');
    const firstPage = Array.from({ length: 100 }, (_, i) => ({
      id: `other-${i}`,
      event_id: `other-event-${i}`,
      agent_id: 'agent-other',
    }));
    const client = approvalClient({
      getOrgApprovals: vi
        .fn()
        .mockResolvedValueOnce({ approvals: { data: firstPage } })
        .mockResolvedValueOnce({
          approvals: {
            data: [
              {
                id: 'approval-row-id-page-2',
                event_id: 'authoritative-event-id-page-2',
                agent_id: 'agent-from-backend',
              },
            ],
          },
        }),
    });

    const identity = await decideApproval(
      client,
      {
        governanceEventId: 'approval-row-id-page-2',
        agentId: 'agent-from-ui',
      },
      'approve',
    );

    expect(client.getOrgApprovals).toHaveBeenNthCalledWith(1, 'org-1', {
      status: 'pending',
      page: 0,
      perPage: 100,
    });
    expect(client.getOrgApprovals).toHaveBeenNthCalledWith(2, 'org-1', {
      status: 'pending',
      page: 1,
      perPage: 100,
    });
    expect(client.decideApproval).toHaveBeenCalledWith(
      'agent-from-ui',
      'authoritative-event-id-page-2',
      { action: 'approve' },
    );
    expect(identity.eventId).toBe('authoritative-event-id-page-2');
  });

  it('falls back to the caller identity if the pending lookup is unavailable', async () => {
    const { decideApproval } = await import('../../ts/src/approvals/resolve');
    const client = approvalClient({
      getOrgApprovals: vi.fn(async () => {
        throw new Error('temporary list failure');
      }),
    });

    const identity = await decideApproval(
      client,
      {
        governanceEventId: 'socket-governance-event-id',
        agentId: 'agent-from-ui',
      },
      'reject',
    );

    expect(client.decideApproval).toHaveBeenCalledWith(
      'agent-from-ui',
      'socket-governance-event-id',
      { action: 'reject' },
    );
    expect(identity).toEqual({
      agentId: 'agent-from-ui',
      eventId: 'socket-governance-event-id',
    });
  });
});
