// AG-UI event-type vocabulary — DECOUPLED from @ag-ui/core on purpose.
//
// The canonical wire values are SCREAMING_SNAKE (the @ag-ui/core `EventType`
// enum values; confirmed for the installed version). We mirror just the subset
// the runtime governs here, as a plain typed const, rather than importing the
// real enum — so the SHARED SDK gains no dependency on @ag-ui/core and stays
// lean. Only the copilotkit module (loaded solely by the copilotkit host, which
// already ships @ag-ui/core) references these. `matchesEventType` also accepts
// the PascalCase form for resilience against older/alternate AG-UI builds, so
// every event-type check lives in one typed place instead of scattered string
// comparisons that could silently drift.

export const AGUI_EVENT = {
  TEXT_MESSAGE_START: 'TEXT_MESSAGE_START',
  TEXT_MESSAGE_CONTENT: 'TEXT_MESSAGE_CONTENT',
  TEXT_MESSAGE_CHUNK: 'TEXT_MESSAGE_CHUNK',
  TEXT_MESSAGE_END: 'TEXT_MESSAGE_END',
  TOOL_CALL_START: 'TOOL_CALL_START',
  TOOL_CALL_ARGS: 'TOOL_CALL_ARGS',
  TOOL_CALL_ARGUMENTS: 'TOOL_CALL_ARGUMENTS',
  TOOL_CALL_END: 'TOOL_CALL_END',
  TOOL_CALL_RESULT: 'TOOL_CALL_RESULT',
  RUN_FINISHED: 'RUN_FINISHED',
  RUN_ERROR: 'RUN_ERROR',
  MESSAGES_SNAPSHOT: 'MESSAGES_SNAPSHOT',
} as const;

export type AguiEventType = (typeof AGUI_EVENT)[keyof typeof AGUI_EVENT];

// 'TEXT_MESSAGE_START' -> 'TextMessageStart' (legacy-casing fallback).
export function aguiPascalCase(type: AguiEventType): string {
  return type
    .toLowerCase()
    .replace(/(^|_)([a-z])/g, (_m, _p, c: string) => c.toUpperCase());
}

/**
 * True if `event.type` is any of the given canonical AG-UI event types, matching
 * the SCREAMING_SNAKE wire value or its PascalCase fallback.
 */
export function matchesEventType(
  event: { type?: unknown },
  ...types: AguiEventType[]
): boolean {
  const t = String(event.type);
  return types.some((type) => t === type || t === aguiPascalCase(type));
}
