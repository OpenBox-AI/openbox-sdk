// Pin HOOK_SPEC.events. The spec is regenerated from adapters.tsp;
// if a future spec change silently drops or renames an event, every
// downstream consumer (the runtime hook handler and bundled plugin
// hooks.json) breaks. The pin here fails loudly the moment the list
// shifts.

import { describe, it, expect } from 'vitest';
import { HOOK_SPEC } from '../../ts/src/core-client/generated/runtime/cursor.js';

const EXPECTED_EVENTS = [
  'beforeSubmitPrompt',
  'beforeReadFile',
  'beforeShellExecution',
  'beforeMCPExecution',
  'preToolUse',
  'afterAgentResponse',
  'afterAgentThought',
  'afterShellExecution',
  'afterFileEdit',
  'afterMCPExecution',
  'postToolUse',
  'postToolUseFailure',
  'sessionStart',
  'stop',
  'beforeTabFileRead',
  'afterTabFileEdit',
  'sessionEnd',
  'preCompact',
  'subagentStart',
  'subagentStop',
];

describe('cursor HOOK_SPEC', () => {
  it('exposes every Cursor hook event in spec order', () => {
    const names = HOOK_SPEC.events.map((e) => e.name);
    expect(names).toEqual(EXPECTED_EVENTS);
  });

  it('uses the cursor-keyed event style consumed by the plugin hooks file', () => {
    expect(HOOK_SPEC.style).toBe('cursor-keyed');
    expect(HOOK_SPEC.key).toBe('hooks');
  });

  it('command routes through `openbox cursor hook` (the spec-emitted CLI verb)', () => {
    // The runtime command must drive through the bundled CLI verb so
    // every event lands in one place where governance + logging +
    // verdict-emit live. Drift here means cursor would invoke a
    // hand-rolled path bypassing observability.
    expect(HOOK_SPEC.command).toBe('openbox cursor hook');
  });
});
