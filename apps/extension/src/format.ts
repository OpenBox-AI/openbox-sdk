// Single source for any user-visible OpenBox copy.
//
// Em / en dashes (U+2014, U+2013) are forbidden in OpenBox strings.
// Backend rule reject_messages frequently include them; every render
// site has to call sanitizeReason() before showing the text. The
// `[OpenBox]` prefix is enforced through brandedMessage(); applying
// it twice is a no-op (idempotent).

const DASH_RE = /[—–]/g;
const COLLAPSE_SPACES = / {2,}/g;

/** Strip em / en dashes; collapse multi-spaces; trim. Idempotent. */
export function sanitizeReason(raw: string | undefined | null): string {
  if (!raw) return "";
  return raw.replace(DASH_RE, " - ").replace(COLLAPSE_SPACES, " ").trim();
}

/** Sanitize and ensure the message starts with `[OpenBox]`. */
export function brandedMessage(raw: string | undefined | null): string {
  const clean = sanitizeReason(raw);
  if (!clean) return "[OpenBox]";
  return clean.startsWith("[OpenBox]") ? clean : `[OpenBox] ${clean}`;
}

/** Human label for a Cursor hook event name (used in toasts). */
export function eventLabel(hookEvent: string | undefined | null): string {
  switch (hookEvent) {
    case "beforeShellExecution":
      return "Shell command";
    case "beforeReadFile":
      return "File read";
    case "beforeMCPExecution":
      return "MCP tool call";
    case "beforeSubmitPrompt":
      return "Prompt submission";
    case "beforeTabFileRead":
      return "Tab file read";
    case "preToolUse":
      return "Tool call";
    case "subagentStart":
      return "Subagent spawn";
    case "afterFileEdit":
      return "File edit";
    case "afterShellExecution":
      return "Shell completion";
    case "afterMCPExecution":
      return "MCP completion";
    default:
      return hookEvent ?? "Action";
  }
}
