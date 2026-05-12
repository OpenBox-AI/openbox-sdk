// Extension-specific message hygiene. `eventLabel` delegates to
// the SDK's `hookEventLabel`, which is the canonical hook-event
// label map every consumer should read from.
//
// Em and en dashes (U+2014, U+2013) are forbidden in OpenBox
// user-visible strings. Backend rule reject messages frequently
// include them, so every render site must call `sanitizeReason`
// before display. The `[OpenBox]` prefix is enforced through
// `brandedMessage`; applying it twice is a no-op.

import { hookEventLabel } from "openbox-sdk/governance";

const DASH_RE = /[—–]/g;
const COLLAPSE_SPACES = / {2,}/g;

/** Strips em and en dashes, collapses runs of spaces, and trims.
 *  Idempotent. */
export function sanitizeReason(raw: string | undefined | null): string {
  if (!raw) return "";
  return raw.replace(DASH_RE, " - ").replace(COLLAPSE_SPACES, " ").trim();
}

/** Sanitizes the input and ensures the message starts with
 *  `[OpenBox]`. */
export function brandedMessage(raw: string | undefined | null): string {
  const clean = sanitizeReason(raw);
  if (!clean) return "[OpenBox]";
  return clean.startsWith("[OpenBox]") ? clean : `[OpenBox] ${clean}`;
}

/** Human label for a hook event name. Delegates to the SDK so the
 *  map stays consistent across mobile, extension, and CLI. */
export const eventLabel = hookEventLabel;
