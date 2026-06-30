/**
 * Single source for tiny async primitives.
 *
 * `sleep` was previously copy-pasted (behaviourally identical) across the
 * polling loops. It now lives here so there is exactly one canonical
 * implementation — edit here, never fork. No drift.
 */

/** Resolve after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
