/**
 * Single source for path string helpers.
 *
 * These were previously copy-pasted byte-for-byte across the runtime
 * worktree mapper and the anthropic-agent-sdk hooks. They now live here as
 * the single canonical implementation — edit here, never fork. No drift.
 */

/**
 * Reduce an arbitrary label to a safe single path segment: keep only
 * `[A-Za-z0-9._-]`, collapse runs of other characters to `-`, strip leading
 * and trailing dashes, and fall back to `worktree` when nothing remains.
 */
export function sanitizePathSegment(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return sanitized || 'worktree';
}
