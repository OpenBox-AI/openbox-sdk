/**
 * Single source for tolerant JSON file reading.
 *
 * `readJsonFile` was previously copy-pasted (byte-for-byte, under the local
 * name `readJson`) across the runtime plugin modules. It now lives here so
 * there is exactly one canonical implementation — edit here, never fork. No
 * drift.
 *
 * The `→ {}` defaulting variants (loadJson / loadJsonConfig) and the
 * string-parsers (parseJsonObject / parseJsonRecord) have DIFFERENT
 * defaults/inputs and are intentionally NOT consolidated here.
 */
import { readFileSync } from 'node:fs';

/** Parse a JSON file into a record, or `undefined` when missing/invalid. */
export function readJsonFile(file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
