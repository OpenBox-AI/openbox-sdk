import type { OpenBoxClient } from 'openbox-sdk/client';

/**
 * Cross-session analyzer for one agent. Used by `openbox agent audit <id>`.
 * Designed so session/event fetching is encapsulated here and callers just
 * render or JSON-dump the result.
 */

type Session = Record<string, unknown> & {
  id: string;
  status?: string;
  workflow_id?: string;
  run_id?: string;
  started_at?: string;
  ended_at?: string;
  created_at?: string;
};

type EventLog = {
  event_type?: string;
  activity_type?: string;
  activity_id?: string;
  workflow_id?: string;
  status?: string;
  created_at?: string;
  [key: string]: unknown;
};

type GuardrailRow = {
  id: string;
  name?: string;
  guardrail_type?: string;
  processing_stage?: string;
  settings?: {
    activities?: Array<{ activity_type?: string; fields_to_check?: string[] }>;
  };
};

export type AuditOptions = {
  sessions?: number;
  maxEvents?: number;
};

export type AuditReport = {
  agent: Record<string, unknown> | null;
  sessions: {
    total: number;
    byStatus: Record<string, number>;
    dangling: number;
    avgDurationMs: number | null;
  };
  events: {
    verdictDistribution: Record<string, number>;
    activityTypeDistribution: Record<string, number>;
    orphanStarts: number;
    orphanCompletes: number;
    sessionsMissingTerminal: number;
    failedActivityCount: number;
  };
  config: {
    active_guardrails: number;
    active_policies: number;
    active_behaviors: number;
  };
  mismatches: Array<{ guardrail: string; configuredType: string; seenCount: number }>;
};

function pickArray<T = unknown>(resp: unknown): T[] {
  if (Array.isArray(resp)) return resp as T[];
  const r = resp as { data?: unknown };
  if (Array.isArray(r?.data)) return r.data as T[];
  const r2 = r?.data as { data?: unknown };
  if (Array.isArray(r2?.data)) return r2.data as T[];
  return [];
}

async function fetchRecentSessions(client: OpenBoxClient, agentId: string, limit: number): Promise<Session[]> {
  const all: Session[] = [];
  let page = 0;
  while (all.length < limit) {
    const resp = await client.listSessions(agentId, { page, perPage: Math.min(100, limit - all.length) });
    const rows = pickArray<Session>(resp);
    if (rows.length === 0) break;
    all.push(...rows);
    const total = (resp as any).total ?? (resp as any).data?.total ?? all.length;
    if (all.length >= total) break;
    page += 1;
    if (page > 50) break;
  }
  return all.slice(0, limit);
}

async function fetchSessionEvents(client: OpenBoxClient, agentId: string, sessionId: string, cap: number): Promise<EventLog[]> {
  const all: EventLog[] = [];
  let page = 0;
  while (all.length < cap) {
    const resp = await client.getSessionLogs(agentId, sessionId, { page, perPage: Math.min(100, cap - all.length) });
    const rows = pickArray<EventLog>(resp);
    all.push(...rows);
    const total = (resp as any).total ?? (resp as any).data?.total ?? all.length;
    if (all.length >= total || rows.length === 0) break;
    page += 1;
    if (page > 100) break;
  }
  return all.slice(0, cap);
}

function analyzeSessions(sessions: Session[], nowMs = Date.now()): AuditReport['sessions'] {
  const byStatus: Record<string, number> = {};
  let dangling = 0;
  const durations: number[] = [];
  for (const s of sessions) {
    const status = (s.status ?? 'unknown').toLowerCase();
    byStatus[status] = (byStatus[status] || 0) + 1;
    const started = s.started_at ?? s.created_at;
    const ended = s.ended_at;
    if (started && ended) {
      const d = new Date(ended as string).getTime() - new Date(started as string).getTime();
      if (Number.isFinite(d) && d >= 0) durations.push(d);
    }
    if (status === 'pending' && started) {
      const age = nowMs - new Date(started as string).getTime();
      if (age > 3600_000) dangling += 1;
    }
  }
  const avg = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
  return { total: sessions.length, byStatus, dangling, avgDurationMs: avg };
}

function analyzeEvents(sessionEvents: Record<string, EventLog[]>): AuditReport['events'] {
  const verdictDist: Record<string, number> = {};
  const activityDist: Record<string, number> = {};
  let orphanStarts = 0;
  let orphanCompletes = 0;
  let sessionsMissingTerminal = 0;
  let failedActivityCount = 0;

  for (const [, events] of Object.entries(sessionEvents)) {
    const starts = new Set<string>();
    const completes = new Set<string>();
    let hasTerminal = false;
    for (const e of events) {
      if (e.activity_type) activityDist[e.activity_type] = (activityDist[e.activity_type] || 0) + 1;
      const v = (e as any).verdict ?? (e as any).action;
      if (typeof v === 'string') verdictDist[v] = (verdictDist[v] || 0) + 1;
      if (e.event_type === 'ActivityStarted' && e.activity_id) starts.add(e.activity_id);
      if (e.event_type === 'ActivityCompleted' && e.activity_id) {
        completes.add(e.activity_id);
        if (e.status === 'failed') failedActivityCount += 1;
      }
      if (e.event_type === 'WorkflowCompleted' || e.event_type === 'WorkflowFailed') hasTerminal = true;
    }
    for (const aid of starts) if (!completes.has(aid)) orphanStarts += 1;
    for (const aid of completes) if (!starts.has(aid)) orphanCompletes += 1;
    if (events.length > 0 && !hasTerminal) sessionsMissingTerminal += 1;
  }

  return { verdictDistribution: verdictDist, activityTypeDistribution: activityDist, orphanStarts, orphanCompletes, sessionsMissingTerminal, failedActivityCount };
}

function findMismatchedActivityTypes(guardrails: GuardrailRow[], seen: Set<string>): AuditReport['mismatches'] {
  const out: AuditReport['mismatches'] = [];
  for (const g of guardrails) {
    for (const a of (g.settings?.activities ?? [])) {
      const t = a.activity_type;
      if (!t) continue;
      if (!seen.has(t)) out.push({ guardrail: g.name ?? g.id, configuredType: t, seenCount: 0 });
    }
  }
  return out;
}

export async function runAgentAudit(client: OpenBoxClient, agentId: string, opts: AuditOptions = {}): Promise<AuditReport> {
  const sessionLimit = opts.sessions ?? 50;
  const maxEvents = opts.maxEvents ?? 500;

  const [agent, sessionsRaw, guardrailsRaw, policies, behaviors] = await Promise.all([
    client.getAgent(agentId).catch(() => null),
    fetchRecentSessions(client, agentId, sessionLimit),
    client.listGuardrails(agentId, { page: 0, perPage: 100 }).catch(() => ({ data: [] } as any)),
    client.getCurrentPolicies(agentId).catch(() => [] as any),
    client.getCurrentBehaviorRules(agentId).catch(() => [] as any),
  ]);

  const sessions = sessionsRaw;
  const guardrails = pickArray<GuardrailRow>(guardrailsRaw);

  const sessionEvents: Record<string, EventLog[]> = {};
  for (const sess of sessions) {
    sessionEvents[sess.id] = await fetchSessionEvents(client, agentId, sess.id, maxEvents);
  }

  const sessionStats = analyzeSessions(sessions);
  const eventStats = analyzeEvents(sessionEvents);
  const seenTypes = new Set(Object.keys(eventStats.activityTypeDistribution));
  const mismatches = findMismatchedActivityTypes(guardrails, seenTypes);

  return {
    agent: agent as any,
    sessions: sessionStats,
    events: eventStats,
    config: {
      active_guardrails: guardrails.length,
      active_policies: Array.isArray(policies) ? policies.length : 0,
      active_behaviors: Array.isArray(behaviors) ? behaviors.length : 0,
    },
    mismatches,
  };
}

export function renderAuditReport(agentId: string, report: AuditReport): void {
  const name = (report.agent as any)?.agent_name ?? agentId;
  const s = report.sessions;
  const e = report.events;

  console.log(`openbox agent audit - ${name} (${agentId})`);
  console.log();
  console.log(`Sessions analyzed: ${s.total}`);
  if (s.total > 0) {
    const statusLine = Object.entries(s.byStatus).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', ');
    console.log(`  status:   ${statusLine}`);
    console.log(`  avg dur:  ${fmtMs(s.avgDurationMs)}`);
    if (s.dangling > 0) {
      console.log(`  \x1b[33mdangling: ${s.dangling} session(s) still PENDING after 1h - run \`openbox session prune ${agentId} --older-than 1h --dry-run\` to review\x1b[0m`);
    }
  }
  console.log();

  console.log(`Config: ${report.config.active_guardrails} active guardrail(s), ${report.config.active_policies} active policy/ies, ${report.config.active_behaviors} active behavior rule(s)`);
  console.log();

  const protocolIssues = e.orphanStarts + e.orphanCompletes + e.sessionsMissingTerminal;
  console.log(`Protocol health:`);
  console.log(`  orphan ActivityStarted (no Completed pair):   ${e.orphanStarts}`);
  console.log(`  orphan ActivityCompleted (no Started pair):   ${e.orphanCompletes}`);
  console.log(`  sessions with no WorkflowCompleted/Failed:    ${e.sessionsMissingTerminal}`);
  console.log(`  activities completed with status=failed:      ${e.failedActivityCount}`);
  if (protocolIssues === 0 && s.total > 0) {
    console.log(`  \x1b[32m✓ all sessions follow paired Start/Complete + terminal protocol\x1b[0m`);
  } else if (protocolIssues > 0) {
    console.log(`  \x1b[33m${protocolIssues} protocol issue(s) - run \`openbox session inspect ${agentId} <id>\` to drill in\x1b[0m`);
  }
  console.log();

  if (Object.keys(e.verdictDistribution).length > 0) {
    console.log(`Verdict distribution:`);
    for (const [v, c] of Object.entries(e.verdictDistribution).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${v.padEnd(22)} ${c}`);
    }
    console.log();
  }

  if (Object.keys(e.activityTypeDistribution).length > 0) {
    console.log(`activity_type distribution (seen in events):`);
    for (const [t, c] of Object.entries(e.activityTypeDistribution).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      console.log(`  ${t.padEnd(24)} ${c}`);
    }
    console.log();
  }

  if (report.mismatches.length > 0) {
    console.log(`\x1b[33mGuardrails configured for activity_types never seen in events:\x1b[0m`);
    for (const m of report.mismatches) {
      console.log(`  "${m.guardrail}" bound to activity_type="${m.configuredType}" - 0 matching events. The guardrail silently never fires.`);
    }
    console.log(`  fix: update the client to send that activity_type, OR edit the guardrail binding to match what the client actually sends.`);
    console.log();
  } else if (report.config.active_guardrails > 0 && s.total > 0) {
    console.log(`\x1b[32m✓ every active guardrail has at least one matching activity_type in recent events\x1b[0m`);
    console.log();
  }

  console.log(`Next actions:`);
  console.log(`  openbox session inspect ${agentId} <id>       # drill into one session`);
  if (s.dangling > 0) console.log(`  openbox session prune ${agentId} --older-than 1h --dry-run  # clean dangling`);
  console.log(`  openbox verify <your-integration-path>        # lint your code for protocol drift`);
}

export function auditHasIssues(report: AuditReport): boolean {
  const e = report.events;
  return e.orphanStarts + e.orphanCompletes + e.sessionsMissingTerminal > 0
    || report.mismatches.length > 0
    || report.sessions.dangling > 0;
}

function fmtMs(ms: number | null): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}min`;
}
