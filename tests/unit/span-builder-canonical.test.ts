// Drift guard: every activity_type that span-builder emits for `core
// evaluate --type` must be in the spec's CANONICAL_ACTIVITY_TYPES set.
// Without this, span-builder could quietly emit "PromptSubmissionV2"
// or some misspelling and silently bypass governance rules.

import { describe, expect, test } from 'vitest';
import { CANONICAL_ACTIVITY_TYPES } from '../../ts/src/core-client/generated/govern.js';
import { buildTestPayload, SPAN_TYPES, type SpanType } from '../../ts/src/test-utils/index.js';

describe('span-builder activity_type drift guard', () => {
  test('buildTestPayload defaults to an activity parent without inline span fields', () => {
    const payload = buildTestPayload({ type: 'http' });

    expect(payload).toMatchObject({
      event_type: 'ActivityStarted',
      hook_trigger: false,
    });
    expect(payload).not.toHaveProperty('spans');
    expect(payload).not.toHaveProperty('span_count');
  });

  test('buildTestPayload emits exactly one span for explicit hook payloads', () => {
    const payload = buildTestPayload({ type: 'http', hookTrigger: true });

    expect(payload).toMatchObject({
      event_type: 'ActivityStarted',
      hook_trigger: true,
      span_count: 1,
    });
    expect(payload.spans).toHaveLength(1);
    expect(payload.spans?.[0]).toMatchObject({
      activity_id: payload.activity_id,
      stage: 'started',
    });
  });

  for (const type of SPAN_TYPES) {
    test(`SPAN_TYPES['${type}'] emits a canonical activity_type`, () => {
      const payload = buildTestPayload({ type: type as SpanType });
      const isCanonical = CANONICAL_ACTIVITY_TYPES.has(payload.activity_type);
      expect(
        isCanonical,
        `span-builder for --type=${type} emitted activity_type='${payload.activity_type}', not in CANONICAL_ACTIVITY_TYPES.\n` +
          `  Either declare the type in spec via @maps_to / @activityRouting, or align span-builder.ts to a canonical name.`,
      ).toBe(true);
    });
  }
});
