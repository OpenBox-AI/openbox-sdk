// Drift guard: every CANONICAL_ACTIVITY_TYPE must have a corresponding
// entry in CANONICAL_ACTIVITY_LABELS, so any consumer (mobile, web, CLI)
// that renders activity_types from a single source of truth never falls
// back to a Title-Case formatter for a *first-party* type.
//
// Adding a new @maps_to / @activityRouting entry without updating the
// `@activityLabels` table on `OpenboxGovern` (specs/typespec/govern/main.tsp)
// fails this test.

import { describe, expect, test } from 'vitest';
import {
  CANONICAL_ACTIVITY_TYPES,
  CANONICAL_ACTIVITY_LABELS,
} from '../../ts/src/core-client/generated/govern.js';

describe('canonical activity_type label coverage', () => {
  test('every CANONICAL_ACTIVITY_TYPE has a label', () => {
    const missing = [...CANONICAL_ACTIVITY_TYPES].filter(
      (t) => !(t in CANONICAL_ACTIVITY_LABELS),
    );
    expect(
      missing,
      `Add labels for these activity_types in the @activityLabels(...) table on ` +
        `OpenboxGovern in specs/typespec/govern/main.tsp:\n  ` +
        missing.join('\n  '),
    ).toEqual([]);
  });

  test('every label key is a canonical activity_type', () => {
    // Inverse: anything in the emitted labels table must come from the
    // canonical set. The emitter already filters non-canonical keys, but
    // pin the invariant here so a future emitter change can't silently
    // leak labels for activity_types nobody emits.
    const orphans = Object.keys(CANONICAL_ACTIVITY_LABELS).filter(
      (k) => !CANONICAL_ACTIVITY_TYPES.has(k),
    );
    expect(orphans, `Orphan labels (no @maps_to / @activityRouting): ${orphans.join(', ')}`).toEqual([]);
  });

  test('labels are non-empty trimmed strings', () => {
    for (const [k, v] of Object.entries(CANONICAL_ACTIVITY_LABELS)) {
      expect(typeof v, `label for ${k} must be a string`).toBe('string');
      expect(v.length, `label for ${k} must be non-empty`).toBeGreaterThan(0);
      expect(v, `label for ${k} must not have leading/trailing whitespace`).toBe(v.trim());
    }
  });

  test('acronym preservation; known UI-critical entries', () => {
    // These ones used to render wrong under the hand-written
    // formatter, producing things like "L L M Completed" or
    // "Mcptoolcall". They are the regression motivation for the
    // spec-driven table. Pin them so the spec can never quietly
    // downgrade them.
    expect(CANONICAL_ACTIVITY_LABELS['LLMCompleted']).toBe('LLM Completed');
    expect(CANONICAL_ACTIVITY_LABELS['MCPToolCall']).toBe('MCP Tool Call');
    expect(CANONICAL_ACTIVITY_LABELS['HTTPRequest']).toBe('HTTP Request');
    expect(CANONICAL_ACTIVITY_LABELS['ShellExecution']).toBe('Shell Execution');
    expect(CANONICAL_ACTIVITY_LABELS['PromptSubmission']).toBe('Prompt Submission');
  });
});
