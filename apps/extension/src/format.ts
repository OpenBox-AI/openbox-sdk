// Extension-specific message hygiene. `eventLabel` delegates to
// the SDK's `hookEventLabel`, which is the canonical hook-event
// label map every consumer should read from.
//
// Em and en dashes (U+2014, U+2013) are forbidden in OpenBox
// user-visible strings. Backend rule reject messages frequently
// include them, so every render site must call `sanitizeReason`
// before display. The `[OpenBox]` prefix is enforced through
// `brandedMessage`; applying it twice is a no-op.

import { hookEventLabel } from "@openbox-ai/openbox-sdk/governance";

const DASH_RE = /[—–]/g;
const COLLAPSE_SPACES = / {2,}/g;
const VISIBLE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bbackend\s+api\b/gi, "OpenBox"],
  [/\bbackend\b/gi, "OpenBox"],
  [/\bruntime\s+key\b/gi, "OpenBox key"],
  [/\borg\s+api\s+key\b/gi, "OpenBox key"],
  [/\bx-api-key\b/gi, "OpenBox key"],
  [/\blocal\s+env\b/gi, "workspace connection"],
  [/\blocal\s+environment\b/gi, "workspace connection"],
];

/** Strips em and en dashes, collapses runs of spaces, and trims.
 *  Idempotent. */
export function sanitizeReason(raw: string | undefined | null): string {
  if (!raw) return "";
  let clean = raw.replace(DASH_RE, " - ");
  for (const [pattern, replacement] of VISIBLE_REPLACEMENTS) {
    clean = clean.replace(pattern, replacement);
  }
  return clean.replace(COLLAPSE_SPACES, " ").trim();
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
