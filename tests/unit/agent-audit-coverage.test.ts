// Coverage for ts/src/cli/commands/agent-audit.ts. The audit module is
// pure-ish: takes an OpenBoxClient + agentId, returns an AuditReport.
// We feed it a stub client that returns synthetic data; that drives
// every analyzer/finder/renderer branch without a backend.

import { describe, it, expect } from 'vitest';
import {
  runAgentAudit,
  renderAuditReport,
  auditHasIssues,
} from '../../ts/src/cli/commands/agent-audit';

function stubClient(overrides: Record<string, () => Promise<any> | any> = {}): any {
  const defaults: Record<string, () => any> = {
    getAgent: async () => ({ agent_name: 'test-agent' }),
    listSessions: async (_agentId: string, q: { page?: number; perPage?: number }) => ({
      data: q?.page === 0 ? [
        { id: 's1', status: 'COMPLETED', started_at: new Date(Date.now() - 60_000).toISOString() },
        { id: 's2', status: 'PENDING', started_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString() },
        { id: 's3', status: 'FAILED', started_at: new Date(Date.now() - 60_000).toISOString() },
      ] : [],
      total: 3,
    }),
    getActiveSessions: async () => ([]),
    getSessionLogs: async (_a: string, sid: string) => ({
      data:
        sid === 's1'
          ? [
              { event_type: 'WorkflowStarted', activity_type: 'PromptSubmission', activity_id: 'a1', status: 'started' },
              { event_type: 'ActivityStarted', activity_type: 'PromptSubmission', activity_id: 'a1', status: 'started' },
              { event_type: 'ActivityCompleted', activity_type: 'PromptSubmission', activity_id: 'a1', status: 'completed' },
              { event_type: 'WorkflowCompleted' },
            ]
          : sid === 's2'
            ? [{ event_type: 'WorkflowStarted', activity_type: 'PromptSubmission', activity_id: 'orphan', status: 'started' }]
            : [],
    }),
    listGuardrails: async () => ({
      data: [
        {
          id: 'g1',
          name: 'no-secrets',
          guardrail_type: 'pii_detection',
          processing_stage: 'output',
          settings: { activities: [{ activity_type: 'NEVER_SEEN_TYPE' }] },
        },
      ],
    }),
    getCurrentPolicies: async () => ([{ id: 'p1' }]),
    getCurrentBehaviorRules: async () => ([{ id: 'b1' }, { id: 'b2' }]),
    ...overrides,
  };
  return new Proxy(defaults, {
    get(t, prop: string) {
      if (prop in t) return (t as any)[prop];
      // Return undefined for unknown methods → triggers .catch fallbacks.
      return undefined;
    },
  });
}

describe('agent-audit', () => {
  it('runAgentAudit returns the full report with synthetic data', async () => {
    const c = stubClient();
    const report = await runAgentAudit(c as any, 'agent-123', { sessions: 5, maxEvents: 50 });
    expect(report.sessions.total).toBe(3);
    expect(report.events.activityTypeDistribution).toBeDefined();
    expect(report.config.active_policies).toBe(1);
    expect(report.config.active_behaviors).toBe(2);
    // Mismatch: guardrail bound to NEVER_SEEN_TYPE; no matching events.
    expect(report.mismatches.length).toBeGreaterThan(0);
  });

  it('renderAuditReport prints all sections and tolerates empty fields', () => {
    const empty = {
      agent: null,
      sessions: { total: 0, byStatus: {}, avgDurationMs: 0, dangling: 0 },
      events: { orphanStarts: 0, orphanCompletes: 0, sessionsMissingTerminal: 0, failedActivityCount: 0, verdictDistribution: {}, activityTypeDistribution: {} },
      config: { active_guardrails: 0, active_policies: 0, active_behaviors: 0 },
      mismatches: [],
      findings: [],
    } as any;
    const orig = console.log;
    const log: string[] = [];
    console.log = (...a: any[]) => log.push(a.join(' '));
    try {
      renderAuditReport('a-empty', empty);
    } finally {
      console.log = orig;
    }
    // Header always renders.
    expect(log.some((l) => l.includes('agent audit'))).toBe(true);
  });

  it('renderAuditReport with rich data exercises mismatch + finding branches', async () => {
    const c = stubClient();
    const report = await runAgentAudit(c as any, 'agent-123');
    const orig = console.log;
    const log: string[] = [];
    console.log = (...a: any[]) => log.push(a.join(' '));
    try {
      renderAuditReport('agent-123', report);
    } finally {
      console.log = orig;
    }
    expect(log.length).toBeGreaterThan(5);
    // Findings/mismatch lines should appear.
    expect(log.some((l) => l.includes('Guardrails') || l.includes('mismatch') || l.includes('Protocol findings'))).toBe(
      true,
    );
  });

  it('auditHasIssues flags mismatches OR fail-level findings', () => {
    const cleanShape = {
      sessions: { total: 0, byStatus: {}, avgDurationMs: 0, dangling: 0 },
      events: { orphanStarts: 0, orphanCompletes: 0, sessionsMissingTerminal: 0, failedActivityCount: 0, verdictDistribution: {}, activityTypeDistribution: {} },
    };
    expect(auditHasIssues({ ...cleanShape, mismatches: [], findings: [] } as any)).toBe(false);
    expect(
      auditHasIssues({ ...cleanShape, mismatches: [{ guardrail: 'g', configuredType: 't' }], findings: [] } as any),
    ).toBe(true);
    expect(
      auditHasIssues({ ...cleanShape, mismatches: [], findings: [{ rule: 'x', level: 'fail', message: 'bad' }] } as any),
    ).toBe(true);
    expect(
      auditHasIssues({ ...cleanShape, mismatches: [], findings: [{ rule: 'x', level: 'warn', message: 'meh' }] } as any),
    ).toBe(false);
    // Dangling sessions also count.
    expect(
      auditHasIssues({ ...cleanShape, sessions: { ...cleanShape.sessions, dangling: 2 }, mismatches: [], findings: [] } as any),
    ).toBe(true);
    // Orphaned events count.
    expect(
      auditHasIssues({ ...cleanShape, events: { ...cleanShape.events, orphanStarts: 3 }, mismatches: [], findings: [] } as any),
    ).toBe(true);
  });

  it('runAgentAudit tolerates fetch errors that have explicit .catch (getAgent / listGuardrails / etc.)', async () => {
    // listSessions doesn't have a .catch wrapper in runAgentAudit, so an
    // empty result is the right "tolerate" path. Errors there propagate
    //; that's by design; the audit can't continue without sessions.
    const c = stubClient({
      getAgent: async () => { throw new Error('fail'); },
      listSessions: async () => ({ data: [], total: 0 }),
      listGuardrails: async () => { throw new Error('fail'); },
      getCurrentPolicies: async () => { throw new Error('fail'); },
      getCurrentBehaviorRules: async () => { throw new Error('fail'); },
    });
    const r = await runAgentAudit(c as any, 'a-broken');
    expect(r.sessions.total).toBe(0);
    expect(r.mismatches).toEqual([]);
    expect(r.config.active_guardrails).toBe(0);
    expect(r.config.active_policies).toBe(0);
  });
});
