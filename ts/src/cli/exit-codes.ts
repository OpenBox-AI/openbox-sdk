// Exit-code taxonomy. The single source of truth; every command MUST
// exit through `reportAndExit` (errors) or `bailWith` (clean exit with a
// specific code). Drift test: no raw `process.exit(...)` allowed in
// `ts/src/cli/**` outside this file and `validators/index.ts`.
//
// Codes are stable: tooling (CI gates, retry loops, scripts) keys off
// numeric values. Renumbering is a breaking change.
export const EXIT = {
  /** Success. */
  OK: 0,

  /** Generic / uncategorized failure. Last resort. */
  GENERIC: 1,

  /** Usage / argv validation error. Commander's default for missing
   *  required option, unknown flag, etc. We follow that convention. */
  USAGE: 2,

  /** Auth failure; 401, 403, missing tokens, expired session. */
  AUTH: 3,

  /** Required feature flag disabled for the active env. */
  FEATURE_DISABLED: 4,

  /** Resource not found; 404. */
  NOT_FOUND: 5,

  /** Conflict; 409 (already-exists, version mismatch, etc.). */
  CONFLICT: 6,

  /** Rate-limited; 429. Caller MAY retry with backoff. */
  RATE_LIMIT: 7,

  /** Server-side failure; 5xx. Caller MAY retry. */
  SERVER: 8,

  /** Network / transport failure (DNS, ECONNREFUSED, timeout). Retryable. */
  NETWORK: 9,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** Map an HTTP status to an exit code. Used by reportAndExit when the
 *  underlying error is an OpenBoxApiError / CoreApiError. */
export function exitCodeForStatus(status: number): ExitCode {
  if (status === 401) return EXIT.AUTH;
  if (status === 403) return EXIT.AUTH;
  if (status === 404) return EXIT.NOT_FOUND;
  if (status === 409) return EXIT.CONFLICT;
  if (status === 429) return EXIT.RATE_LIMIT;
  if (status >= 500) return EXIT.SERVER;
  return EXIT.GENERIC;
}

/** Whether the exit code represents a transient condition the caller may retry. */
export function isRetryable(code: ExitCode): boolean {
  return code === EXIT.RATE_LIMIT || code === EXIT.SERVER || code === EXIT.NETWORK;
}

/** Clean (non-error) exit with a specific code + optional stderr message.
 *  Use for "this command intentionally exits non-zero to signal X" cases:
 *    - feature flag disabled (EXIT.FEATURE_DISABLED)
 *    - verify rule severity above threshold (EXIT.GENERIC by convention,
 *      but the caller picks)
 *    - missing required input under --non-interactive (EXIT.USAGE) */
export function bailWith(code: ExitCode, message?: string): never {
  if (message) console.error(message);
  process.exit(code);
}
