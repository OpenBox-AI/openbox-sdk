/**
 * Single source for string-extraction helpers.
 *
 * These tiny helpers were previously copy-pasted (byte-for-byte) across many
 * modules — `firstText`, `firstTrimmed`, the trimmed `firstString` family and
 * the trimmed `stringFrom` family all shared identical logic. They now live
 * here so there is exactly one canonical implementation — edit here, never
 * fork. No drift.
 *
 * Two behavioural variants exist and MUST stay distinct:
 *  - the TRIMMED variants (`firstTrimmed` / `stringFrom`) return the value
 *    AFTER `.trim()`.
 *  - the RAW variants (`firstUntrimmed` / `stringFromRaw`) gate on a non-empty
 *    trimmed value but return the ORIGINAL, UNTRIMMED value.
 */

/**
 * First value that is a non-empty string after `.trim()`, returned TRIMMED.
 * Byte-identical logic of the former `firstText` / `firstTrimmed` helpers and
 * the trimmed `firstString` family.
 */
export function firstTrimmed(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

/**
 * `typeof value === 'string' && value.trim() ? value.trim() : undefined` — the
 * common TRIMMED single-value variant.
 */
export function stringFrom(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Like {@link firstTrimmed} but returns the ORIGINAL, UNTRIMMED value. Gate is
 * still a non-empty trimmed string. Preserves the behaviour of the drifted
 * untrimmed `firstString` variant.
 */
export function firstUntrimmed(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

/**
 * Like {@link stringFrom} but returns the ORIGINAL, UNTRIMMED value. Gate is
 * still a non-empty trimmed string. Preserves the behaviour of the drifted
 * untrimmed `stringFrom` variant.
 */
export function stringFromRaw(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
