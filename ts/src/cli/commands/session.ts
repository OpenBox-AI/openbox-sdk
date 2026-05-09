// `openbox session`; list / active / get / logs / goal-stats /
// terminate / trace are spec-driven (H.3). `inspect` and `prune` stay
// hand-coded: inspect runs a pagination-walking protocol-conformance
// validator, prune does bulk-terminate with progress streaming .
// neither fits a declarative call shape.
import { Command } from 'commander';
import { getClient } from '../config.js';
import { wireSubcommands } from '../wire-subcommands.js';
import { wireRecipes } from '../recipes.js';
import { SESSION_HANDLERS } from '../generated/cli-handlers/session.js';
import { SESSION_RECIPES } from '../generated/cli-recipes/session.js';
import { reportAndExit } from '../../validators/index.js';
import { EXIT, bailWith } from '../exit-codes.js';
import { isQuiet, requireYesForDestructive } from '../non-interactive.js';
import { error, warn, info, kv, row, summary } from '../output.js';
import {
  CANONICAL_EVENT_TYPES,
  CANONICAL_ACTIVITY_TYPES,
  CANONICAL_VERDICT_ARMS,
} from '../../core-client/generated/govern.js';

// Parse "30s" / "5m" / "2h" / "1d" / bare seconds into milliseconds.
// Dangling cleanup must set this explicitly; no default, per user requirement.
function parseDuration(spec: string): number {
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
  activity_id?: string;
  activity_type?: string;
  activity_input?: unknown;
  verdict?: string;
  action?: string;
  status?: string;
  [key: string]: unknown;
};

type InspectFinding = { level: 'ok' | 'info' | 'warn' | 'fail'; message: string };

// Production verdict set. Same as CANONICAL_VERDICT_ARMS minus
// `constrain` (removed from the production wire; any `constrain` on
// the wire today is a stale SDK or hand-rolled client).
const CANONICAL_VERDICTS: ReadonlySet<string> = new Set(
  [...CANONICAL_VERDICT_ARMS].filter((v) => v !== 'constrain'),
);

function inspectEvents(events: EventLog[]): InspectFinding[] {
  const findings: InspectFinding[] = [];
  const counts: Record<string, number> = {};
  const workflowIds = new Set<string>();
  const runIds = new Set<string>();
  const starts = new Map<string, EventLog>();
  const completes = new Map<string, EventLog>();
  let hasTerminal = false;
  const nonCanonicalEventTypes = new Set<string>();
  const badVerdicts = new Set<string>();
  let badActivityInput = 0;
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
    if (e.event_type && !CANONICAL_EVENT_TYPES.has(e.event_type as never)) nonCanonicalEventTypes.add(e.event_type);
    if (e.activity_type) {
      const bucket = CANONICAL_ACTIVITY_TYPES.has(e.activity_type) ? canonicalActivity : customActivity;
      bucket[e.activity_type] = (bucket[e.activity_type] || 0) + 1;
    }
    const verdict = e.verdict ?? e.action;
    if (typeof verdict === 'string' && !CANONICAL_VERDICTS.has(verdict)) badVerdicts.add(verdict);
    if ('activity_input' in e && e.activity_input != null && !Array.isArray(e.activity_input)) badActivityInput += 1;
  }

  if (workflowIds.size === 0) findings.push({ level: 'fail', message: 'no workflow_id found on any event' });
  else if (workflowIds.size > 1) findings.push({ level: 'fail', message: `multiple workflow_ids in one session (${[...workflowIds].join(', ')}); IDs must stay constant across the session` });
  else findings.push({ level: 'ok', message: `workflow_id consistent: ${[...workflowIds][0]}` });
  if (runIds.size > 1) findings.push({ level: 'fail', message: `multiple run_ids (${[...runIds].join(', ')}); run_id must stay constant across the session` });

  const startedCount = counts['WorkflowStarted'] || 0;
  if (startedCount === 0) findings.push({ level: 'fail', message: 'no WorkflowStarted event' });
  else if (startedCount > 1) findings.push({ level: 'fail', message: `${startedCount} WorkflowStarted events (expected 1)` });
  else findings.push({ level: 'ok', message: 'exactly one WorkflowStarted' });

  const dangling: string[] = [];
  for (const [aid] of starts) if (!completes.has(aid)) dangling.push(aid);
  const orphanCompletes: string[] = [];
  for (const [aid] of completes) if (!starts.has(aid)) orphanCompletes.push(aid);
  if (dangling.length > 0) findings.push({ level: 'fail', message: `${dangling.length} ActivityStarted without matching ActivityCompleted: ${dangling.slice(0, 3).join(', ')}${dangling.length > 3 ? '…' : ''}` });
  if (orphanCompletes.length > 0) findings.push({ level: 'fail', message: `${orphanCompletes.length} ActivityCompleted without matching ActivityStarted: ${orphanCompletes.slice(0, 3).join(', ')}${orphanCompletes.length > 3 ? '…' : ''}` });
  if (dangling.length === 0 && orphanCompletes.length === 0 && starts.size > 0) findings.push({ level: 'ok', message: `${starts.size} activity pair(s) match cleanly` });

  if (!hasTerminal) findings.push({ level: 'fail', message: 'no WorkflowCompleted or WorkflowFailed; session is dangling. Every session must finalize in a finally/defer block.' });
  else findings.push({ level: 'ok', message: 'terminal WorkflowCompleted/WorkflowFailed present' });

  const failedActivities = [...completes.values()].filter((e) => e.status === 'failed');
  if (failedActivities.length > 0) findings.push({ level: 'warn', message: `${failedActivities.length} activit${failedActivities.length === 1 ? 'y' : 'ies'} completed with status=failed (expected if the workload had errors; not a protocol violation)` });

  if (nonCanonicalEventTypes.size > 0) findings.push({ level: 'fail', message: `non-canonical event_type value(s): ${[...nonCanonicalEventTypes].join(', ')}; must be one of ${[...CANONICAL_EVENT_TYPES].join('|')}` });

  const canonicalEntries = Object.entries(canonicalActivity).sort((a, b) => b[1] - a[1]);
  const customEntries = Object.entries(customActivity).sort((a, b) => b[1] - a[1]);
  if (canonicalEntries.length > 0 || customEntries.length > 0) {
    const fmt = (entries: Array<[string, number]>) => entries.map(([k, v]) => `${k} (${v})`).join(', ');
    const lines: string[] = ['activity_type inventory:'];
    if (canonicalEntries.length > 0) lines.push(`  canonical:    ${fmt(canonicalEntries)}`);
    if (customEntries.length > 0) {
      lines.push(`  custom:       ${fmt(customEntries)}`);
      lines.push(`  Configure guardrails against the exact strings above; custom names won't match guardrails targeting canonical values.`);
    }
    findings.push({ level: 'info', message: lines.join('\n  ') });
  }

  if (badVerdicts.size > 0) findings.push({ level: 'fail', message: `non-canonical verdict(s): ${[...badVerdicts].join(', ')}; must be allow|require_approval|block|halt` });
  if (badActivityInput > 0) findings.push({ level: 'fail', message: `${badActivityInput} event(s) have activity_input that is not an array (must be an array per governance-flow.md)` });

  return findings;
}

export function registerSessionCommands(program: Command) {
  const session = program.command('session').description('Session management');
  wireSubcommands(session, SESSION_HANDLERS, getClient as never);
  wireRecipes(session, SESSION_RECIPES, getClient as never);

  // Custom: protocol-validate a session against the canonical event_type
  // contract. The body is a multi-page paginate + ad-hoc renderer.
  session
    .command('inspect <agentId> <sessionIdOrWorkflowId>')
    .description('Validate the client-side workflow protocol for a session (pairing, terminal, ID consistency)')
    .action(async (agentId: string, ref: string) => {
      try {
        const client = getClient();
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
          if (arr.length > 1) warn(`${arr.length} sessions match "${ref}"; inspecting the first (${sessionId})`);
        }

        const all: EventLog[] = [];
        let page = 0;
        while (true) {
          const resp = await client.getSessionLogs(agentId, sessionId, { page, perPage: 100 });
          const data = ((resp as any).data ?? (resp as any)) as EventLog[];
          const arr: EventLog[] = Array.isArray(data) ? data : ((data as any).data ?? []);
          all.push(...arr);
          const total = (resp as any).total;
          if (arr.length === 0 || (typeof total === 'number' && all.length >= total)) break;
          page += 1;
          if (page > 200) break;
        }

        info(`session ${sessionId}`);
        kv({
          status: session.status ?? 'unknown',
          workflow_id: session.workflow_id ?? '-',
          run_id: session.run_id ?? '-',
          started_at: session.started_at ?? session.created_at ?? '-',
          completed_at: session.completed_at ?? '-',
          events: all.length,
        });
        info('');

        const findings = inspectEvents(all);
        info('protocol check:');
        for (const f of findings) {
          // Map inspect's level to a row status: ok→pass, fail→fail, warn→warn, info→unchanged.
          const status = f.level === 'ok' ? 'pass' : f.level === 'info' ? 'unchanged' : f.level;
          row('', status, f.message);
        }

        const failedCount = findings.filter((f) => f.level === 'fail').length;
        const warnCount = findings.filter((f) => f.level === 'warn').length;
        const passCount = findings.filter((f) => f.level === 'ok').length;
        summary({ pass: passCount, warn: warnCount, fail: failedCount });
        if (failedCount > 0) {
          info('See references/governance-flow.md for the full contract.');
          bailWith(EXIT.GENERIC);
        }
      } catch (err) {
        reportAndExit(err);
      }
    });

  // Custom: bulk-terminate dangling PENDING sessions older than threshold.
  session
    .command('prune <agentId>')
    .description('Bulk-terminate dangling PENDING sessions older than a threshold')
    .requiredOption('--older-than <duration>', 'Minimum age of sessions to terminate. Examples: 30s, 5m, 2h, 1d. Required; no default.')
    .option('--dry-run', 'List what would be terminated without actually terminating', false)
    .option('--limit <n>', 'Cap on number to terminate in one run', '1000')
    .action(async (agentId: string, opts) => {
      try {
        // --dry-run is the safe escape; no termination, no --yes needed.
        if (!opts.dryRun) requireYesForDestructive('session prune');
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
          info(`no dangling sessions older than ${opts.olderThan} found on agent ${agentId}.`);
          return;
        }
        info(`found ${candidates.length} dangling session(s) older than ${opts.olderThan}:`);
        for (const s of candidates.slice(0, 10)) info(`  ${s.id}  started=${s.started_at ?? s.created_at}  workflow_id=${s.workflow_id ?? '-'}`);
        if (candidates.length > 10) info(`  … and ${candidates.length - 10} more`);

        const toTerminate = candidates.slice(0, limit);
        if (opts.dryRun) {
          info('');
          info(`--dry-run: would terminate ${toTerminate.length} session(s). Re-run without --dry-run to apply.`);
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
            error(`failed to terminate ${s.id}: ${err.message || err}`);
          }
          if (!isQuiet() && ((i + 1) % 10 === 0 || i === toTerminate.length - 1)) {
            warn(`progress: terminated=${ok} failed=${failed} total=${toTerminate.length}`);
          }
        }
        summary({ removed: ok, failed, skipped: candidates.length - toTerminate.length });
        if (failed > 0) bailWith(EXIT.GENERIC);
      } catch (err) {
        reportAndExit(err);
      }
    });
}
