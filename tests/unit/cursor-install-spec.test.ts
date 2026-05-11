// Pin INSTALL_SPEC.events. The spec is regenerated from
// adapters.tsp; if a future spec change silently drops or renames
// an event, every downstream consumer (the runtime hook handler,
// the bundled hooks.json, the install writer) breaks. The pin here
// fails loudly the moment the list shifts.

import { describe, it, expect } from 'vitest';
import { INSTALL_SPEC } from '../../ts/src/core-client/generated/runtime/cursor.js';

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

describe('cursor INSTALL_SPEC', () => {
  it('exposes every Cursor hook event in spec order', () => {
    const names = INSTALL_SPEC.events.map((e) => e.name);
    expect(names).toEqual(EXPECTED_EVENTS);
  });

  it('writes to ~/.cursor/hooks.json with the cursor-keyed style', () => {
    expect(INSTALL_SPEC.style).toBe('cursor-keyed');
    expect(INSTALL_SPEC.file).toBe('~/.cursor/hooks.json');
    expect(INSTALL_SPEC.key).toBe('hooks');
  });

  it('command routes through `openbox cursor hook` (the spec-emitted CLI verb)', () => {
    // The runtime command must drive through the bundled CLI verb so
    // every event lands in one place where governance + logging +
    // verdict-emit live. Drift here means cursor would invoke a
    // hand-rolled path bypassing observability.
    expect(INSTALL_SPEC.command).toBe('openbox cursor hook');
  });
});
