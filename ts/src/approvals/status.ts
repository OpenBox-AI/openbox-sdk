// Bucket each approval into one of four kinds for History-style views.
// Consumers that don't show pending in the same surface (e.g. a History
// tab) drop the 'pending' rows; the bucket is still computed identically.
//
// Precedence:
//   1. wire `status` if present ("approved" / "rejected" / "expired" /
//      "pending"); the backend's explicit signal.
//   2. otherwise: decided_at + verdict — Allow/Constrain on a decided
//      row -> approved; Block/Halt -> rejected.
//   3. otherwise: undecided + approval_expired_at past -> expired.
//      Mock fixtures encode expiry exactly this way (verdict=2 +
//      decided_at=null + approval_expired_at<now) and rely on the
//      consumer to derive the bucket. Without this branch every
//      expired-by-timeout row falls through to "pending" and
//      vanishes from a History view.

export type SectionStatus = 'approved' | 'rejected' | 'expired';
export type ApprovalBucket = SectionStatus | 'pending';

interface Bucketable {
  status?: string | null;
  verdict?: number | null;
  decided_at?: string | null;
  approval_expired_at?: string | null;
}

export function statusOf(a: Bucketable): ApprovalBucket {
  const s = (a.status || '').toLowerCase();
  if (s === 'approved') return 'approved';
  if (s === 'rejected') return 'rejected';
  if (s === 'expired') return 'expired';
  if (a.decided_at) {
    if (a.verdict === 0 || a.verdict === 1) return 'approved';
    if (a.verdict === 3 || a.verdict === 4) return 'rejected';
  }
  if (a.approval_expired_at && !a.decided_at) {
    const t = Date.parse(a.approval_expired_at);
    if (Number.isFinite(t) && t < Date.now()) return 'expired';
  }
  return 'pending';
}
