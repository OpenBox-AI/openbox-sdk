// Workflow event names shared across host adapters. These constants
// belong at the transport layer; every adapter fires the same events
// for activity start, complete, and signal regardless of which host
// invoked the action. Host-specific activity-type vocabularies (such
// as cursor's snake_case `llm_prompt` or claude-code's PascalCase
// `PromptSubmission`) live alongside each adapter in its own
// `activity-types.ts`.

export const EVENT = {
  START: 'ActivityStarted',
  COMPLETE: 'ActivityCompleted',
  SIGNAL: 'SignalReceived',
} as const;
