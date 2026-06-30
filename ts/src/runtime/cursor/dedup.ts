// Per-action dedup and decision handoff for concurrent Cursor hook subprocesses.
// A stable filesystem claim lets one subprocess evaluate governance while the
// others wait for and mirror the same decision.
//
// TTL: 1 hour. Stale lock files older than TTL are considered
// abandoned (winner crashed without publishing). Best-effort cleanup
// happens on each new claim attempt.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { openboxDataRoot } from '../../env/os-paths.js';
import { SessionStore } from '../../session/store.js';
import type { CursorConfig } from './config.js';

const TTL_MS = 60 * 60 * 1000; // 1h
const POLL_INTERVAL_MS = 100;
// Match Cursor's hook subprocess timeout ceiling (per the bundle's
// validator warning at 3600s). If the winner doesn't publish by
// then, Cursor has already killed both subprocesses anyway.
const DEFAULT_AWAIT_TIMEOUT_MS = 60 * 60 * 1000; // 1h

function dedupDir(): string {
  return path.join(openboxDataRoot(), 'run', 'dedup');
}

function ensureDir(): void {
  try {
    fs.mkdirSync(dedupDir(), { recursive: true, mode: 0o700 });
  } catch {
    /* best-effort; claim() will fail loudly if the dir really isn't there */
  }
}

/** Best-effort sweep of stale lock files. Cheap; runs on each claim. */
function reapStale(): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(dedupDir());
  } catch {
    return;
  }
  const cutoff = Date.now() - TTL_MS;
  for (const name of entries) {
    const p = path.join(dedupDir(), name);
    try {
      const st = fs.statSync(p);
      if (st.mtimeMs < cutoff) fs.unlinkSync(p);
    } catch {
      /* race with another process; ignore */
    }
  }
}

function hashKey(raw: string): string {
  return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16);
}

/**
 * Build a stable dedup key for one logical tool invocation. Order of
 * components matters for legibility but the hash collapses to a fixed
 * length anyway.
 *
 * `generation_id` (per-model-generation) + `kind` (shell/read/...) +
 * `arg` (the discriminating field; command / file_path / tool_name)
 * is enough to identify one action across the events Cursor fires
 * for it. Two different actions with the same command in the same
   * generation would collide (rare); publish grace plus timeout-deny
   * behavior limits the blast radius.
 *
 * conversation_id is the stable key when generation_id is missing
 * (some envelopes don't carry it consistently).
 */
export function buildActionKey(parts: {
  generation_id?: string;
  conversation_id?: string;
  kind: 'shell' | 'read' | 'write' | 'mcp' | 'prompt' | 'subagent' | 'tab_read';
  arg: string;
}): string {
  const ns = parts.generation_id || parts.conversation_id || 'no-ns';
  return hashKey(`${ns}:${parts.kind}:${parts.arg}`);
}

export function claimCompletionTelemetry(parts: {
  generation_id?: string;
  conversation_id?: string;
  kind: 'shell' | 'read' | 'write' | 'mcp';
  arg?: string;
}): boolean {
  const arg = parts.arg?.trim();
  if (!arg) return true;
  return claimAction(completionActivityKey({ ...parts, arg })).won;
}

interface PendingToolActivity {
  activityId: string;
  activityType: string;
  startTime: number;
}

const activityStores = new WeakMap<CursorConfig, SessionStore>();

function activityStoreFor(cfg: CursorConfig): SessionStore {
  let store = activityStores.get(cfg);
  if (!store) {
    store = new SessionStore(path.join(cfg.sessionDir, 'tool-activities'));
    activityStores.set(cfg, store);
  }
  return store;
}

function completionActivityKey(parts: {
  generation_id?: string;
  conversation_id?: string;
  kind: 'shell' | 'read' | 'write' | 'mcp';
  arg: string;
}): string {
  return buildActionKey({ ...parts, arg: `completion:${parts.arg}` });
}

export function rememberCompletionActivity(
  parts: {
    generation_id?: string;
    conversation_id?: string;
    kind: 'shell' | 'read' | 'write' | 'mcp';
    arg?: string;
  },
  cfg: CursorConfig,
  activity: PendingToolActivity,
): void {
  const arg = parts.arg?.trim();
  if (!arg) return;
  activityStoreFor(cfg).save(
    completionActivityKey({ ...parts, arg }),
    { ...activity },
  );
}

export function takeCompletionActivity(
  parts: {
    generation_id?: string;
    conversation_id?: string;
    kind: 'shell' | 'read' | 'write' | 'mcp';
    arg?: string;
  },
  cfg: CursorConfig,
): PendingToolActivity | null {
  const arg = parts.arg?.trim();
  if (!arg) return null;
  const key = completionActivityKey({ ...parts, arg });
  const store = activityStoreFor(cfg);
  const record = store.load(key) as Partial<PendingToolActivity> | null;
  store.delete(key);
  if (
    !record ||
    typeof record.activityId !== 'string' ||
    typeof record.activityType !== 'string' ||
    typeof record.startTime !== 'number'
  ) {
    return null;
  }
  return {
    activityId: record.activityId,
    activityType: record.activityType,
    startTime: record.startTime,
  };
}

export interface ActionClaim {
  /** True if this caller won the claim and should run the gate. */
  won: boolean;
  /** Path to the lock file. Used for diagnostics. */
  path: string;
}

/**
 * Atomically attempt to claim an action. Returns `won: true` for the
 * first caller; subsequent callers within the TTL get `won: false`
 * and should emit a no-op verdict.
 *
 * Implementation: `open(O_WRONLY | O_CREAT | O_EXCL)` is the POSIX
 * atomic-create primitive. Node exposes it as the `wx` flag. Whoever
 * succeeds at create owns the claim; everyone else gets EEXIST.
 *
   * On any unexpected filesystem error (disk full, permission denied),
   * return `won: true` so this subprocess still runs the governance gate.
   * Better to double-evaluate than to silently allow.
 */
export function claimAction(key: string): ActionClaim {
  ensureDir();
  reapStale();
  const lockPath = path.join(dedupDir(), key);
  try {
    const fd = fs.openSync(lockPath, 'wx', 0o600);
    try {
      fs.writeSync(fd, String(Date.now()));
    } finally {
      fs.closeSync(fd);
    }
    return { won: true, path: lockPath };
  } catch (err: NodeJS.ErrnoException | any) {
    if (err?.code === 'EEXIST') {
      if (publishedDecisionExpired(lockPath)) {
        try {
          fs.unlinkSync(lockPath);
          const fd = fs.openSync(lockPath, 'wx', 0o600);
          fs.closeSync(fd);
          return { won: true, path: lockPath };
        } catch {
          return { won: false, path: lockPath };
        }
      }
      // Another subprocess won the claim. Check it's not stale; if
      // it is, take it over. (reapStale() above would normally have
      // unlinked it, but a race is possible.)
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > TTL_MS) {
          fs.unlinkSync(lockPath);
          // Try one more time. If this also fails, give up and
          // claim won: false (the other process beat us).
          try {
            const fd = fs.openSync(lockPath, 'wx', 0o600);
            fs.closeSync(fd);
            return { won: true, path: lockPath };
          } catch {
            return { won: false, path: lockPath };
          }
        }
      } catch {
        /* file vanished between EEXIST and stat; treat as fresh lost claim */
      }
      return { won: false, path: lockPath };
    }
    // Unexpected error (EACCES, ENOSPC, etc): run the governance gate
    // in this subprocess instead of allowing silently.
    return { won: true, path: lockPath };
  }
}

/**
 * The decision the winner of a claim publishes to the lock file when
 * its session.activity returns. Losers poll for this and mirror it
 * back to Cursor.
 */
export interface ClaimDecision {
  arm: 'allow' | 'constrain' | 'require_approval' | 'block' | 'halt';
  reason: string;
  governanceChecksIncomplete?: boolean;
}

/** Grace window after publishing the decision before the winner
 *  unlinks the lock file. Long enough for any loser still polling
 *  to read the decision (poll interval is 100ms), short enough that
 *  a re-issued identical action gets a FRESH gate instead of
 *  inheriting the prior decision.
 *
 *  Without this unlink, the lock's published decision becomes a
 *  cross-turn approval cache: the same command issued in a later
 *  turn within the TTL would read the prior verdict and silently
 *  proceed. That's the opposite of what governance wants.
 */
const PUBLISH_GRACE_MS = 800;

/**
 * Winner: publish the decision so losers can stop polling and return
 * a matching verdict to Cursor. Atomic via tmp-file + rename so
 * losers never read a half-written file.
 *
 * After the grace window, the lock is unlinked so re-issues of the
 * same logical action gate freshly. The grace is sync-fire-and-forget
 * (setTimeout in the same subprocess); if the subprocess exits before
 * the timer fires, the lock remains and the next claim's `reapStale`
 * sweep picks it up at TTL.
 */
export function publishClaimDecision(claim: ActionClaim, decision: ClaimDecision): void {
  if (!claim.won) return;
  const tmp = `${claim.path}.tmp.${process.pid}`;
  try {
    fs.writeFileSync(
      tmp,
      JSON.stringify({
        ts: Date.now(),
        arm: decision.arm,
        reason: decision.reason,
        governanceChecksIncomplete: decision.governanceChecksIncomplete === true,
      }),
      { mode: 0o600 },
    );
    fs.renameSync(tmp, claim.path);
    // Schedule the cleanup. NOT unref'd: we want the subprocess to
    // stay alive long enough for the timer to fire and unlink the
    // lock. Otherwise the subprocess exits, the timer is cancelled,
    // and the lock orphans for its full TTL; turning the
    // wait-for-decision lock into a cross-turn approval cache.
    setTimeout(() => {
      try { fs.unlinkSync(claim.path); } catch { /* already gone */ }
    }, PUBLISH_GRACE_MS);
  } catch {
    // Best-effort. If we fail to publish, losers poll until their
    // deadline and then return a block verdict.
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function readDecisionOnce(lockPath: string): ClaimDecision | null {
  let content: string;
  try {
    content = fs.readFileSync(lockPath, 'utf-8');
  } catch {
    return null; // file vanished or unreadable; treat as not-ready
  }
  let parsed: { arm?: string; reason?: string; governanceChecksIncomplete?: unknown };
  try {
    parsed = JSON.parse(content);
  } catch {
    return null; // mid-write or malformed; retry next tick
  }
  if (typeof parsed.arm !== 'string') return null;
  return {
    arm: parsed.arm as ClaimDecision['arm'],
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    governanceChecksIncomplete: parsed.governanceChecksIncomplete === true,
  };
}

function publishedDecisionExpired(lockPath: string): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as { ts?: unknown; arm?: unknown };
    return typeof parsed.arm === 'string' &&
      typeof parsed.ts === 'number' &&
      Date.now() - parsed.ts > PUBLISH_GRACE_MS;
  } catch {
    return false;
  }
}

// Single spec-driven source: the canonical reader is generated into govern.ts
// from the verdict-response contract. Re-exported here so cursor mappers keep
// their `../dedup.js` import path while sharing the one implementation.
export { verdictHasIncompleteGovernanceChecks } from '../../core-client/index.js';

/**
 * Loser: poll the lock file until the winner publishes a decision, or
 * the deadline passes. Returns the decision, or null on timeout.
 *
 * On timeout, callers must block the duplicate hook because no
 * authoritative governance decision was published.
 */
export async function awaitClaimDecision(
  claim: ActionClaim,
  deadlineMs: number = DEFAULT_AWAIT_TIMEOUT_MS,
): Promise<ClaimDecision | null> {
  if (claim.won) return null; // winners don't wait on themselves
  // Cap to a sane upper bound so a misconfigured caller doesn't hang
  // the hook subprocess for days.
  const wait = Number.isFinite(deadlineMs) && deadlineMs > 0
    ? Math.min(deadlineMs, DEFAULT_AWAIT_TIMEOUT_MS)
    : DEFAULT_AWAIT_TIMEOUT_MS;
  const deadline = Date.now() + wait;
  // Optimistic first read in case the winner already published before
  // we even got here.
  const first = readDecisionOnce(claim.path);
  if (first) return first;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const decision = readDecisionOnce(claim.path);
    if (decision) return decision;
  }
  return null;
}

/** Pattern matching Cursor's spec @activityVariant for Shell → FileDelete. */
const RM_PATTERN = /\b(rm|unlink|rmdir|shred)\b/;

/** True if a shell command should be reclassified as file-delete. */
export function isFileDeleteCommand(command: string | undefined | null): boolean {
  if (!command) return false;
  return RM_PATTERN.test(command);
}
