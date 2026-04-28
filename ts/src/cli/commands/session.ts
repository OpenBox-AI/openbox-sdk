import { Command } from 'commander';
import { getClient } from '../config.js';
import { output, outputList } from '../output.js';
import { reportAndExit, parsePagination, validateEnum, validateIsoDate } from '../validators/index.js';

// Session status enum from ts/types/src/requests.ts:26.
const SESSION_STATUSES = ['pending', 'completed', 'failed', 'blocked', 'halted'] as const;
// Duration buckets accepted by GetSessionsDto.
const SESSION_DURATIONS = ['<1min', '1-5mins', '5-15mins', '>15mins'] as const;

// Parse "30s" / "5m" / "2h" / "1d" / bare seconds into milliseconds.
// Dangling cleanup must set this explicitly - no default, per user requirement.
function parseDuration(spec: string): number {
  // Order matters: `ms` must be tested before `m` so "30ms" doesn't match the `m` minute case first.
  const m = spec.match(/^(\d+)\s*(ms|s|m|h|d)?$/i);
  if (!m) throw new Error(`invalid duration: "${spec}" (use 30ms, 30s, 5m, 2h, 1d, or bare seconds)`);
  const n = parseInt(m[1], 10);
  const unit = (m[2] || 's').toLowerCase();
  const mult: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return n * mult[unit];
}

type EventLog = {
  event_type?: string;
  workflow_id?: string;
  run_id?: string;
  session_id?: string;
  activity_id?: string;
  activity_type?: string;
  activity_input?: unknown;
  verdict?: string;
  action?: string;
  status?: string;
  created_at?: string;
  timestamp?: string;
  [key: string]: unknown;
};

type InspectFinding = { level: 'ok' | 'info' | 'warn' | 'fail'; message: string };

// Canonical activity_type values emitted by first-party SDKs. Backend accepts
// free-form strings, so non-canonical values are `warn` (work, but drift from
// the skill contract and won't match guardrails configured against these
// canonical names). See governance-flow.md § Canonical activity_type Names.
const CANONICAL_ACTIVITY_TYPES = new Set([
  'PromptSubmission',
  'FileRead',
  'FileEdit',
  'FileDelete',
  'ShellExecution',
  'ShellOutput',
  'HTTPRequest',
  'MCPToolCall',
  'MCPToolResponse',
  'AgentResponse',
  'AgentThinking',
  'AgentSpawn',
  'ClaudeCodeSession',
  'CursorSession',
  'LLMCompleted',
  'ToolCompleted',
  'DefaultActivity',
]);

// Six canonical event_types - enforced hard. Anything else is a protocol bug.
const CANONICAL_EVENT_TYPES = new Set([
  'WorkflowStarted',
  'SignalReceived',
  'ActivityStarted',
  'ActivityCompleted',
  'WorkflowCompleted',
  'WorkflowFailed',
]);

// Production verdicts. `constrain` was removed - any value outside this set
// on the wire is a bug somewhere (stale SDK, hand-rolled client, etc.).
const CANONICAL_VERDICTS = new Set(['allow', 'require_approval', 'block', 'halt']);

function inspectEvents(events: EventLog[]): InspectFinding[] {
  const findings: InspectFinding[] = [];

  const counts: Record<string, number> = {};
  const workflowIds = new Set<string>();
  const runIds = new Set<string>();
  const starts = new Map<string, EventLog>(); // activity_id -> ActivityStarted
  const completes = new Map<string, EventLog>(); // activity_id -> ActivityCompleted
  let hasTerminal = false;

  const nonCanonicalEventTypes = new Set<string>();
  const badVerdicts = new Set<string>();
  let badActivityInput = 0;
  // Split activity_type counts by canonical vs custom. Custom is not a
  // protocol violation (backend accepts free-form strings, and custom agents
  // legitimately name their own activities). The inventory is emitted as an
  // info-level report so the user can see what guardrails need to target.
  const canonicalActivity: Record<string, number> = {};
  const customActivity: Record<string, number> = {};

  for (const e of events) {
    const t = e.event_type || 'unknown';
    counts[t] = (counts[t] || 0) + 1;
    if (e.workflow_id) workflowIds.add(e.workflow_id);
    if (e.run_id) runIds.add(e.run_id);
    if (t === 'ActivityStarted' && e.activity_id) starts.set(e.activity_id, e);
    if (t === 'ActivityCompleted' && e.activity_id) completes.set(e.activity_id, e);
    if (t === 'WorkflowCompleted' || t === 'WorkflowFailed') hasTerminal = true;

    if (e.event_type && !CANONICAL_EVENT_TYPES.has(e.event_type)) {
      nonCanonicalEventTypes.add(e.event_type);
    }
    if (e.activity_type) {
      const bucket = CANONICAL_ACTIVITY_TYPES.has(e.activity_type)
        ? canonicalActivity
        : customActivity;
      bucket[e.activity_type] = (bucket[e.activity_type] || 0) + 1;
    }
    const verdict = e.verdict ?? e.action;
    if (typeof verdict === 'string' && !CANONICAL_VERDICTS.has(verdict)) {
      badVerdicts.add(verdict);
    }
    // session_id is NOT a wire-contract field per governance-flow.md - it's a
    // DB-side identifier assigned at ingestion. Don't flag its absence as a
    // protocol violation; that would fire against every conformant SDK.
    if ('activity_input' in e && e.activity_input != null && !Array.isArray(e.activity_input)) {
      badActivityInput += 1;
    }
  }

  // 1. Workflow/run ID consistency.
  if (workflowIds.size === 0) {
    findings.push({ level: 'fail', message: 'no workflow_id found on any event' });
  } else if (workflowIds.size > 1) {
    findings.push({
      level: 'fail',
      message: `multiple workflow_ids in one session (${[...workflowIds].join(', ')}) - IDs must stay constant across the session`,
    });
  } else {
    findings.push({ level: 'ok', message: `workflow_id consistent: ${[...workflowIds][0]}` });
  }

  if (runIds.size > 1) {
    findings.push({
      level: 'fail',
      message: `multiple run_ids (${[...runIds].join(', ')}) - run_id must stay constant across the session`,
    });
  }

  // 2. WorkflowStarted count.
  const startedCount = counts['WorkflowStarted'] || 0;
  if (startedCount === 0) findings.push({ level: 'fail', message: 'no WorkflowStarted event' });
  else if (startedCount > 1) findings.push({ level: 'fail', message: `${startedCount} WorkflowStarted events (expected 1)` });
  else findings.push({ level: 'ok', message: 'exactly one WorkflowStarted' });

  // 3. Activity Start/Complete pairing.
  const dangling: string[] = [];
  for (const [aid] of starts) if (!completes.has(aid)) dangling.push(aid);
  const orphanCompletes: string[] = [];
  for (const [aid] of completes) if (!starts.has(aid)) orphanCompletes.push(aid);
  if (dangling.length > 0) {
    findings.push({
      level: 'fail',
      message: `${dangling.length} ActivityStarted without matching ActivityCompleted: ${dangling.slice(0, 3).join(', ')}${dangling.length > 3 ? '…' : ''}`,
    });
  }
  if (orphanCompletes.length > 0) {
    findings.push({
      level: 'fail',
      message: `${orphanCompletes.length} ActivityCompleted without matching ActivityStarted: ${orphanCompletes.slice(0, 3).join(', ')}${orphanCompletes.length > 3 ? '…' : ''}`,
    });
  }
  if (dangling.length === 0 && orphanCompletes.length === 0 && starts.size > 0) {
    findings.push({ level: 'ok', message: `${starts.size} activity pair(s) match cleanly` });
  }

  // 4. Terminal event.
  if (!hasTerminal) {
    findings.push({
      level: 'fail',
      message: 'no WorkflowCompleted or WorkflowFailed - session is dangling. Every session must finalize in a finally/defer block.',
    });
  } else {
    findings.push({ level: 'ok', message: 'terminal WorkflowCompleted/WorkflowFailed present' });
  }

  // 5. Failed activities - informational, not a fail.
  const failedActivities = [...completes.values()].filter((e) => e.status === 'failed');
  if (failedActivities.length > 0) {
    findings.push({
      level: 'warn',
      message: `${failedActivities.length} activit${failedActivities.length === 1 ? 'y' : 'ies'} completed with status=failed (expected if the workload had errors - not a protocol violation)`,
    });
  }

  // 6. Canonical event_type. Hard rule: the 6 canonical values are exhaustive.
  if (nonCanonicalEventTypes.size > 0) {
    findings.push({
      level: 'fail',
      message: `non-canonical event_type value(s): ${[...nonCanonicalEventTypes].join(', ')} - must be one of ${[...CANONICAL_EVENT_TYPES].join('|')}`,
    });
  }

  // 7. Activity_type inventory. Not a protocol violation - activity_type is
  // free-form on the wire. For a custom agent, custom names are by design.
  // For hook/tool emitter correctness, use `openbox verify` on the source.
  // What matters here: show the vocabulary so the user can line up guardrails.
  const canonicalEntries = Object.entries(canonicalActivity).sort((a, b) => b[1] - a[1]);
  const customEntries = Object.entries(customActivity).sort((a, b) => b[1] - a[1]);
  if (canonicalEntries.length > 0 || customEntries.length > 0) {
    const fmt = (entries: Array<[string, number]>) =>
      entries.map(([k, v]) => `${k} (${v})`).join(', ');
    const lines: string[] = ['activity_type inventory:'];
    if (canonicalEntries.length > 0) {
      lines.push(`  canonical:    ${fmt(canonicalEntries)}`);
    }
    if (customEntries.length > 0) {
      lines.push(`  custom:       ${fmt(customEntries)}`);
      lines.push(
        `  Configure guardrails against the exact strings above - custom names won't match guardrails targeting canonical values.`,
      );
    }
    findings.push({ level: 'info', message: lines.join('\n  ') });
  }

  // 8. Verdict enum. A stray `constrain` or invented value means a stale SDK
  // or hand-rolled client is emitting values that newer rules don't branch on.
  if (badVerdicts.size > 0) {
    findings.push({
      level: 'fail',
      message: `non-canonical verdict(s): ${[...badVerdicts].join(', ')} - must be allow|require_approval|block|halt`,
    });
  }

  // 9. activity_input must be an array when present.
  if (badActivityInput > 0) {
    findings.push({
      level: 'fail',
      message: `${badActivityInput} event(s) have activity_input that is not an array (must be an array per governance-flow.md)`,
    });
  }

  // No receive-order timestamp check: backend routinely paginates events in
  // DESC order, which would flag every consecutive pair as a "regression" and
  // drown real findings in noise. A true monotonicity check would need to
  // sort first and detect mixed-direction sequences - low-value given the
  // protocol doesn't mandate a direction. Drop.

  return findings;
}

export function registerSessionCommands(program: Command) {
  const session = program.command('session').description('Session management');

  session
    .command('list <agentId>')
    .description('List sessions for an agent')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .option('--status <status>', `Filter by status (${SESSION_STATUSES.join('|')})`)
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .option('--duration <dur>', `Duration filter (${SESSION_DURATIONS.join('|')})`)
    .option('-s, --search <text>', 'Search')
    .action(async (agentId: string, opts) => {
      try {
        if (opts.status) validateEnum(opts.status, SESSION_STATUSES, '--status');
        if (opts.duration) validateEnum(opts.duration, SESSION_DURATIONS, '--duration');
        if (opts.from) validateIsoDate(opts.from, '--from');
        if (opts.to) validateIsoDate(opts.to, '--to');
        const data = await getClient().listSessions(agentId, {
          ...parsePagination(opts),
          status: opts.status,
          fromTime: opts.from,
          toTime: opts.to,
          duration: opts.duration,
          search: opts.search,
        });
        outputList(data, 'sessions');
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  session
    .command('active <agentId>')
    .description('Get active sessions for an agent')
    .action(async (agentId: string) => {
      try {
        const data = await getClient().getActiveSessions(agentId);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  session
    .command('get <agentId> <sessionId>')
    .description('Get session details')
    .action(async (agentId: string, sessionId: string) => {
      try {
        const data = await getClient().getSession(agentId, sessionId);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  session
    .command('logs <agentId> <sessionId>')
    .description('Get session logs')
    .option('-p, --page <n>', 'Page number', '0')
    .option('-l, --limit <n>', 'Items per page', '10')
    .option('--event-type <type>', 'Filter by event type')
    .action(async (agentId: string, sessionId: string, opts) => {
      try {
        const data = await getClient().getSessionLogs(agentId, sessionId, {
          ...parsePagination(opts),
          event_type: opts.eventType,
        });
        outputList(data, 'logs');
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  session
    .command('goal-stats <agentId> <sessionId>')
    .description('Get session goal alignment stats')
    .action(async (agentId: string, sessionId: string) => {
      try {
        const data = await getClient().getSessionGoalAlignmentStats(agentId, sessionId);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  session
    .command('trace <agentId> <sessionId>')
    .description('Get session reasoning trace')
    .action(async (agentId: string, sessionId: string) => {
      try {
        const data = await getClient().getSessionReasoningTrace(agentId, sessionId);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  session
    .command('terminate <agentId> <sessionId>')
    .description('Terminate a session')
    .action(async (agentId: string, sessionId: string) => {
      try {
        const data = await getClient().terminateSession(agentId, sessionId);
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  session
    .command('inspect <agentId> <sessionIdOrWorkflowId>')
    .description('Validate the client-side workflow protocol for a session (pairing, terminal, ID consistency)')
    .action(async (agentId: string, ref: string) => {
      try {
        const client = getClient();
        // Accept either a session UUID or a workflow_id. Try direct fetch first; on 404, search.
        let sessionId = ref;
        let session: any;
        try {
          session = await client.getSession(agentId, ref);
        } catch {
          const list = await client.listSessions(agentId, { search: ref, perPage: 5 });
          const items = (list as any).data ?? list;
          const arr = Array.isArray(items) ? items : (items.data ?? []);
          if (arr.length === 0) throw new Error(`no session found with id or workflow_id matching "${ref}"`);
          session = arr[0];
          sessionId = session.id;
          if (arr.length > 1) {
            console.error(`note: ${arr.length} sessions match "${ref}"; inspecting the first (${sessionId})`);
          }
        }

        // Paginate all logs so the pairing check has a complete picture.
        const all: EventLog[] = [];
        let page = 0;
        while (true) {
          const resp = await client.getSessionLogs(agentId, sessionId, { page, perPage: 100 });
          const data = ((resp as any).data ?? (resp as any)) as EventLog[];
          const arr: EventLog[] = Array.isArray(data) ? data : ((data as any).data ?? []);
          all.push(...arr);
          // Backend may omit `total` - treating it as `all.length` creates a
          // self-fulfilling exit after page 1. Rely on `arr.length === 0` as
          // the real terminator; use `total` only when the backend provides it.
          const total = (resp as any).total;
          if (arr.length === 0 || (typeof total === 'number' && all.length >= total)) break;
          page += 1;
          if (page > 200) break; // sanity guard - 20k events is plenty
        }

        console.log(`session ${sessionId}`);
        console.log(`  status:       ${session.status ?? 'unknown'}`);
        console.log(`  workflow_id:  ${session.workflow_id ?? '-'}`);
        console.log(`  run_id:       ${session.run_id ?? '-'}`);
        console.log(`  started_at:   ${session.started_at ?? session.created_at ?? '-'}`);
        console.log(`  completed_at: ${session.completed_at ?? '-'}`);
        console.log(`  events:       ${all.length}`);
        console.log();

        const findings = inspectEvents(all);
        console.log('protocol check:');
        for (const f of findings) {
          const mark =
            f.level === 'ok' ? '✓' :
            f.level === 'info' ? 'i' :
            f.level === 'warn' ? '!' : '✗';
          console.log(`  ${mark} ${f.message}`);
        }

        const failed = findings.filter((f) => f.level === 'fail').length;
        if (failed > 0) {
          console.log(`\n${failed} protocol violation${failed === 1 ? '' : 's'}. See references/governance-flow.md for the full contract.`);
          process.exit(2);
        }
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  session
    .command('prune <agentId>')
    .description('Bulk-terminate dangling PENDING sessions older than a threshold')
    .requiredOption('--older-than <duration>', 'Minimum age of sessions to terminate (e.g. 30s, 5m, 2h, 1d). REQUIRED - no default.')
    .option('--dry-run', 'List what would be terminated without actually terminating', false)
    .option('--limit <n>', 'Cap on number to terminate in one run', '1000')
    .action(async (agentId: string, opts) => {
      try {
        const olderThanMs = parseDuration(opts.olderThan);
        const limit = parseInt(opts.limit, 10);
        const cutoff = Date.now() - olderThanMs;

        const client = getClient();
        const active = await client.getActiveSessions(agentId);
        const candidates = (active as any[]).filter((s) => {
          const startedAt = s.started_at ?? s.created_at;
          if (!startedAt) return false;
          return new Date(startedAt).getTime() < cutoff;
        });

        if (candidates.length === 0) {
          console.log(`no dangling sessions older than ${opts.olderThan} found on agent ${agentId}.`);
          return;
        }

        console.log(`found ${candidates.length} dangling session(s) older than ${opts.olderThan}:`);
        for (const s of candidates.slice(0, 10)) {
          console.log(`  ${s.id}  started=${s.started_at ?? s.created_at}  workflow_id=${s.workflow_id ?? '-'}`);
        }
        if (candidates.length > 10) console.log(`  … and ${candidates.length - 10} more`);

        const toTerminate = candidates.slice(0, limit);
        if (opts.dryRun) {
          console.log(`\n--dry-run: would terminate ${toTerminate.length} session(s). Re-run without --dry-run to apply.`);
          return;
        }

        let ok = 0;
        let failed = 0;
        for (let i = 0; i < toTerminate.length; i++) {
          const s = toTerminate[i];
          try {
            await client.terminateSession(agentId, s.id);
            ok++;
          } catch (err: any) {
            failed++;
            console.error(`  failed to terminate ${s.id}: ${err.message || err}`);
          }
          if ((i + 1) % 10 === 0 || i === toTerminate.length - 1) {
            process.stderr.write(`\rterminated ${ok} / ${toTerminate.length} (${failed} failed)`);
          }
        }
        console.error('');
        console.log(`done: ${ok} terminated, ${failed} failed. ${candidates.length - toTerminate.length} deferred by --limit.`);
        if (failed > 0) process.exit(1);
      } catch (err: any) {
        reportAndExit(err);
      }
    });
}
