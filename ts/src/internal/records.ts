/**
 * Single source for record/object/array coercion helpers.
 *
 * These tiny coercion functions were previously copy-pasted byte-for-byte across
 * many modules. They now live here so there is exactly one canonical
 * implementation — edit here, never fork. No drift.
 */

/** Coerce a value to a plain record, or `{}` when it is not a non-array object. */
export function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** First non-empty record among the given values, or `{}` when none qualify. */
export function firstRecord(...values: unknown[]): Record<string, unknown> {
  for (const value of values) {
    const record = objectRecord(value);
    if (Object.keys(record).length > 0) return record;
  }
  return {};
}

/** Coerce a value to an array, or `[]` when it is not an array. */
export function arrayFrom(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Type guard: true when `value` is a non-array object. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** Type guard: true when `value` is a plain object that owns `key`. */
export function hasOwnKey(value: unknown, key: string): value is Record<string, unknown> {
  return isPlainObject(value) && Object.prototype.hasOwnProperty.call(value, key);
}
