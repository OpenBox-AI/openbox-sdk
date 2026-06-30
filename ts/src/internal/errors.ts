/**
 * Single source for error-to-message helpers.
 *
 * These tiny helpers were previously copy-pasted (byte-for-byte) across many
 * modules — the `errorMessage` form (`err instanceof Error ? err.message :
 * String(err)`) and the `reasonFromError` prefixer. They now live here so there
 * is exactly one canonical implementation — edit here, never fork. No drift.
 *
 * Behavioural variants that are NOT byte-identical to `errorMessage` live with
 * their owners and are intentionally NOT consolidated here, because folding
 * them in would change behaviour:
 *  - copilotkit/otel-capture.ts `errorString` falls back to `error.name` and
 *    special-cases string errors.
 *  - governance/spans.ts `errorDescription` returns `undefined` for empty input
 *    and adds a `JSON.stringify` fallback.
 */

/** `err instanceof Error ? err.message : String(err)` — the common form. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Prefix a human-readable reason with an error detail, or return just the
 * prefix when there is no detail. Byte-identical to the former per-runtime
 * `reasonFromError` helpers.
 */
export function reasonFromError(prefix: string, err?: unknown): string {
  const detail = err instanceof Error ? err.message : String(err ?? '');
  return detail ? `${prefix}: ${detail}` : prefix;
}
