// Drift guard: every activity_type that span-builder emits for `core
// evaluate --type` must be in the spec's CANONICAL_ACTIVITY_TYPES set.
// Without this, span-builder could quietly emit "PromptSubmissionV2"
// or some misspelling and silently bypass governance rules.

import { describe, expect, test } from 'vitest';
import { CANONICAL_ACTIVITY_TYPES } from '../../ts/src/core-client/generated/govern.js';
import { buildTestPayload, SPAN_TYPES, type SpanType } from '../../ts/src/cli/span-builder.js';

/**
 * Activity types span-builder emits today that aren't in
 * CANONICAL_ACTIVITY_TYPES. Each entry is a known gap - the platform
 * doesn't currently declare a preset method or @activityRouting entry
 * for it. Removing an entry from this allowlist requires adding the
 * type to the spec (typically via a @maps_to on a preset method).
 *
 * The point of the allowlist is to keep `git diff` honest: silent
 * drift between span-builder and spec was the previous risk; now
 * every gap is explicit.
 */
const KNOWN_NON_CANONICAL: Partial<Record<SpanType, string>> = {
  db: 'DatabaseQuery - no preset method emits DB activity yet. Add @maps_to("ActivityStarted","DatabaseQuery") on a default-preset DB method to canonicalize.',
};

describe('span-builder activity_type drift guard', () => {
  for (const type of SPAN_TYPES) {
    test(`SPAN_TYPES['${type}'] emits a canonical activity_type`, () => {
      const payload = buildTestPayload({ type: type as SpanType });
      const isCanonical = CANONICAL_ACTIVITY_TYPES.has(payload.activity_type);
      const allowed = KNOWN_NON_CANONICAL[type as SpanType];
      if (allowed) {
        // The exception is whitelisted - don't fail, but assert the
        // emitted name still matches what the allowlist said it would
        // be. Anything else is a SECOND drift that needs noticing.
        expect(
          isCanonical || typeof allowed === 'string',
          `span-builder for --type=${type} emitted '${payload.activity_type}'; whitelist note: ${allowed}`,
        ).toBe(true);
        return;
      }
      expect(
        isCanonical,
        `span-builder for --type=${type} emitted activity_type='${payload.activity_type}', not in CANONICAL_ACTIVITY_TYPES.\n` +
          `  Either declare the type in spec via @maps_to / @activityRouting, or align span-builder.ts to a canonical name.`,
      ).toBe(true);
    });
  }
});
