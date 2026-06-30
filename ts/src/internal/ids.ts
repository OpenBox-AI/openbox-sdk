/**
 * Single source for span/trace id generation.
 *
 * `newSpanId` / `newTraceId` were previously inlined byte-for-byte
 * (`randomBytes(8|16).toString('hex')`) across every span-emitting path. They
 * now live here so there is exactly one canonical implementation — edit here,
 * never fork. No drift.
 *
 * NOTE: `parentSpanIdForActivity` is intentionally NOT here — it remains
 * exported from copilotkit/otel-capture.ts (its canonical home, alongside the
 * capture store it documents); callers import it from there.
 */
import { randomBytes } from 'node:crypto';

/** A fresh 8-byte span id (16 hex characters). */
export function newSpanId(): string {
  return randomBytes(8).toString('hex');
}

/** A fresh 16-byte trace id (32 hex characters). */
export function newTraceId(): string {
  return randomBytes(16).toString('hex');
}
