/**
 * Single source for generic value coercion helpers.
 *
 * These tiny coercion functions were previously copy-pasted byte-for-byte
 * across the host runtime config loaders. They now live here so there is
 * exactly one canonical implementation — edit here, never fork. No drift.
 */

/** Coerce a string flag to boolean: true only for the literals 'true' or '1'. */
export function asBoolean(value: string): boolean {
  return value === 'true' || value === '1';
}
