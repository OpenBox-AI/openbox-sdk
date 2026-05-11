// Per-action dedup + decision-handoff for hook subprocesses that run
// concurrently.
//
// Cursor fires multiple hook events for one logical tool invocation
// (preToolUse + beforeShellExecution + ..., each in its own
// subprocess). Without coordination, each fires its own
// session.activity → backend creates one approval row per event →
// the user sees N toasts for one action.
//
// Cursor's gating contract proceeds the moment any installed hook
// returns allow. The naive "loser just returns allow" dedup loses
// consent when the loser arrives before the winner has its verdict —
// the action runs before the user clicks. So the lock file is also
// the loser's mailbox: the winner writes its eventual decision to
// the file when session.activity returns, and the loser polls until
// the decision is present (or hook timeout) before responding to
// Cursor. Both subprocesses block until consent is real, regardless
// of which event Cursor uses to gate.
//
// Why a file, not a socket: hook subprocesses are short-lived and
// don't know about each other. A filesystem lock at a stable path
// derived from the envelope is the cheapest cross-process primitive
// available; no daemon required.
//
// TTL: 1 hour. Stale lock files older than TTL are considered
// abandoned (winner crashed without publishing). Best-effort cleanup
// happens on each new claim attempt.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

const DEDUP_DIR = path.join(os.homedir(), '.openbox', 'run', 'dedup');
const TTL_MS = 60 * 60 * 1000; // 1h
const POLL_INTERVAL_MS = 100;
// Match Cursor's hook subprocess timeout ceiling (per the bundle's
// validator warning at 3600s). If the winner doesn't publish by
// then, Cursor has already killed both subprocesses anyway.
const DEFAULT_AWAIT_TIMEOUT_MS = 60 * 60 * 1000; // 1h

function ensureDir(): void {
  try {
    fs.mkdirSync(DEDUP_DIR, { recursive: true, mode: 0o700 });
  } catch {
    /* best-effort; claim() will fail loudly if the dir really isn't there */
  }
}

/** Best-effort sweep of stale lock files. Cheap; runs on each claim. */
function reapStale(): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(DEDUP_DIR);
  } catch {
    return;
  }
  const cutoff = Date.now() - TTL_MS;
  for (const name of entries) {
    const p = path.join(DEDUP_DIR, name);
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
 * `arg` (the discriminating field — command / file_path / tool_name)
 * is enough to identify one action across the events Cursor fires
 * for it. Two different actions with the same command in the same
 * generation would collide (rare), but the worst case is "one of
 * them sees an allow without a fresh evaluate" — falls open on
 * accident, which matches the SDK's overall fail-open posture.
 *
 * conversation_id is the fallback when generation_id is missing
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
 * fail open: return `won: true` so the gate runs. Better to
 * double-evaluate than to silently allow.
 */
export function claimAction(key: string): ActionClaim {
  ensureDir();
  reapStale();
  const lockPath = path.join(DEDUP_DIR, key);
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
    // Unexpected error (EACCES, ENOSPC, etc): fail open so governance
    // still runs.
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
      JSON.stringify({ ts: Date.now(), arm: decision.arm, reason: decision.reason }),
      { mode: 0o600 },
    );
    fs.renameSync(tmp, claim.path);
    // Schedule the cleanup. NOT unref'd: we want the subprocess to
    // stay alive long enough for the timer to fire and unlink the
    // lock. Otherwise the subprocess exits, the timer is cancelled,
    // and the lock orphans for its full TTL — turning the
    // wait-for-decision lock into a cross-turn approval cache.
    setTimeout(() => {
      try { fs.unlinkSync(claim.path); } catch { /* already gone */ }
    }, PUBLISH_GRACE_MS);
  } catch {
    // Best-effort. If we fail to publish, losers poll until their
    // deadline and then fail open. That matches the SDK's overall
    // fail-open posture for hook errors.
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
  let parsed: { arm?: string; reason?: string };
  try {
    parsed = JSON.parse(content);
  } catch {
    return null; // mid-write or malformed; retry next tick
  }
  if (typeof parsed.arm !== 'string') return null;
  return {
    arm: parsed.arm as ClaimDecision['arm'],
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
  };
}

/**
 * Loser: poll the lock file until the winner publishes a decision, or
 * the deadline passes. Returns the decision, or null on timeout.
 *
 * On timeout: caller should fail open (return undefined to Cursor),
 * matching the SDK's overall fail-open posture. Cursor's hook
 * subprocess timeout will usually kill us before our own deadline
 * elapses, so this branch is rare in practice.
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
