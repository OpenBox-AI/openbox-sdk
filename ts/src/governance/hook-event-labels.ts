// Human-readable labels for hook event names. Provides a single
// source of truth for toast titles, detail panels, mobile sheets,
// CLI rows, and any other surface that renders an event identifier.
//
// The map is the union of each adapter's spec-emitted
// `HOOK_EVENT_LABELS` constant, which is driven by the
// `@hookEventLabel` decorator in
// `specs/typespec/govern/adapters.tsp`. New labels land here
// automatically when the spec recompiles; no hand-edits required.

import { HOOK_EVENT_LABELS as CURSOR_LABELS } from '../core-client/generated/runtime/cursor.js';
import { HOOK_EVENT_LABELS as CLAUDE_CODE_LABELS } from '../core-client/generated/runtime/claude-code.js';

const HOOK_EVENT_LABELS: Record<string, string> = {
  ...CURSOR_LABELS,
  ...CLAUDE_CODE_LABELS,
};

/**
 * Returns a human-readable label for a hook event name. Falls back
 * to the original identifier when the event is unknown, and to
 * `'Action'` when the input is empty.
 */
export function hookEventLabel(hookEvent: string | undefined | null): string {
  if (!hookEvent) return 'Action';
  return HOOK_EVENT_LABELS[hookEvent] ?? hookEvent;
}

export { HOOK_EVENT_LABELS };
