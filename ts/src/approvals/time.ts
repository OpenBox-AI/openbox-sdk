// Human-readable time strings for approval rows. Read Date.now()
// internally; consumers driving a 1Hz tick get fresh values on every
// tick because the helper is pure-call.

function parseTs(s?: string | null): number {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : Math.floor(t / 1000);
}

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

export function timeAgo(createdAt?: string | null): string {
  const ts = parseTs(createdAt);
  if (!ts) return '';
  // Clamp negative diffs to 0 so a sim/device clock that runs slightly
  // behind the server doesn't latch the value at "just now" forever.
  // Without this, a created_at that appears to be in the future from
  // the device's POV would always satisfy the early-return path and
  // never tick up.
  const diff = Math.max(0, nowEpoch() - ts);
  // "just now" is reserved for the first 3 seconds; long enough to
  // read but short enough that the row doesn't latch on stale state
  // for nearly a minute. After that we show real seconds resolution.
  if (diff < 3) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function timeRemaining(expiresAt?: string | null): string {
  const ts = parseTs(expiresAt);
  if (!ts) return '';
  const diff = ts - nowEpoch();
  if (diff <= 0) return 'expired';
  // Seconds resolution sub-minute. Consumers driving a global 1Hz tick
  // get a fresh value per call; each "12s -> 11s -> 10s" advance
  // re-renders just the time text without disturbing the parent card.
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  const hrs = Math.floor(diff / 3600);
  const rmins = Math.floor((diff % 3600) / 60);
  return rmins > 0 ? `${hrs}h ${rmins}m` : `${hrs}h`;
}
