// specs/typespec/govern/adapters.tsp - hook-protocol adapter shapes.
//
// Adapters describe stdin/stdout JSON hook protocols (Claude Code hooks,
// Cursor hooks). The emitter generates one `runtime/<name>` module per
// @adapter interface that:
//   1. Reads stdin JSON
//   2. Dispatches by the `discriminator` field to the matching @hookEvent
//      operation (which binds to a method on the underlying @preset).
//   3. Translates the verdict to the operation's @verdictShape stdout JSON.
//   4. Writes stdout + exits.
//
// This is a programming-model spec, not an HTTP API. Output shapes are
// platform contracts (Claude Code / Cursor specs); the emitter has a
// fixed registry of how each `verdictShape` family translates the four
// verdict arms to stdout JSON.

import "typespec-workflow";

using OpenBox.Workflow;

namespace OpenboxGovern.Adapters;

// ---------------------------------------------------------------------------
// Claude Code hook protocol
// ---------------------------------------------------------------------------

/**
 * Common stdin envelope Claude Code writes for every hook event. Per-event
 * required fields differ; the emitter's runtime validates them at dispatch
 * time using the @hookEvent metadata + a small per-event required-fields
 * table baked into the adapter module.
 */
model ClaudeHookEnvelope {
  hook_event_name: string;
  session_id: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_output?: unknown;
  tool_use_id?: string;
  cwd?: string;
  transcript_path?: string;
  prompt?: string;
  `model`?: string;
  agent_id?: string;
  agent_type?: string;
  permission_mode?: string;
  permission_suggestions?: unknown;
}

/**
 * Claude Code hook adapter - single binary that dispatches every hook
 * event by `hook_event_name`. Binds to the `claude-code` preset.
 */
@adapter("claude-hooks", "claude-code", "hook_event_name")
interface ClaudeHooksAdapter {
  /**
   * PreToolUse: agent is about to call a tool. Routing by `tool_name`
   * to the appropriate activity_type lives in the @activityRouting
   * table - runtime mappers consume the generated constant instead of
   * hand-coding the same switch.
   *
   * Tools not listed (`Glob`, `Grep`, etc.) are pass-through (allow).
   * mcp__* tools resolve to MCPToolCall via runtime fallback.
   */
  @hookEvent("PreToolUse")
  @verdictShape("permission-decision")
  @activityRouting(#{
    Read: "FileRead",
    Write: "FileEdit",
    Edit: "FileEdit",
    Delete: "FileDelete",
    Bash: "ShellExecution",
    WebFetch: "HTTPRequest",
    WebSearch: "HTTPRequest",
    Agent: "AgentSpawn",
  })
  preToolUse(input: ClaudeHookEnvelope): unknown;

  @hookEvent("PostToolUse")
  @verdictShape("decision-block")
  @activityRouting(#{
    Read: "FileRead",
    Write: "FileEdit",
    Edit: "FileEdit",
    Delete: "FileDelete",
    Bash: "ShellExecution",
    WebFetch: "HTTPRequest",
    WebSearch: "HTTPRequest",
    Agent: "AgentSpawn",
  })
  postToolUse(input: ClaudeHookEnvelope): unknown;

  @hookEvent("UserPromptSubmit")
  @verdictShape("decision-block")
  userPromptSubmit(input: ClaudeHookEnvelope): unknown;

  @hookEvent("PermissionRequest")
  @verdictShape("permission-request")
  @activityRouting(#{
    Read: "FileRead",
    Write: "FileEdit",
    Edit: "FileEdit",
    Delete: "FileDelete",
    Bash: "ShellExecution",
    WebFetch: "HTTPRequest",
    WebSearch: "HTTPRequest",
    Agent: "AgentSpawn",
  })
  permissionRequest(input: ClaudeHookEnvelope): unknown;

  @hookEvent("PreCompact")
  @verdictShape("none")
  preCompact(input: ClaudeHookEnvelope): unknown;

  @hookEvent("SessionStart")
  @verdictShape("none")
  sessionStart(input: ClaudeHookEnvelope): unknown;

  @hookEvent("SessionEnd")
  @verdictShape("none")
  sessionEnd(input: ClaudeHookEnvelope): unknown;

  @hookEvent("SubagentStart")
  @verdictShape("none")
  subagentStart(input: ClaudeHookEnvelope): unknown;

  @hookEvent("SubagentStop")
  @verdictShape("none")
  subagentStop(input: ClaudeHookEnvelope): unknown;

  @hookEvent("Stop")
  @verdictShape("none")
  stop(input: ClaudeHookEnvelope): unknown;

  @hookEvent("Notification")
  @verdictShape("none")
  notification(input: ClaudeHookEnvelope): unknown;
}

// ---------------------------------------------------------------------------
// Cursor hook protocol
// ---------------------------------------------------------------------------

/**
 * Common stdin envelope Cursor writes for every hook. Like the Claude
 * envelope, per-event required fields differ; runtime validation lives
 * in the generated adapter module.
 */
model CursorHookEnvelope {
  hook_event_name: string;
  conversation_id: string;
  generation_id?: string;
  prompt?: string;
  file_path?: string;
  command?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_output?: unknown;
  thought?: string;
  response?: string;
}

/**
 * Cursor hook adapter - single binary that dispatches every Cursor hook
 * event by `hook_event_name`. Binds to the `cursor` preset.
 *
 * Cursor's `before*` hooks return `{permission, userMessage?, ...}` and
 * are governance gates; `after*` hooks are observational (telemetry only)
 * and return void. The verdictShape encodes which mapping the runtime uses.
 */
@adapter("cursor-hooks", "cursor", "hook_event_name")
interface CursorHooksAdapter {
  @hookEvent("beforeSubmitPrompt")
  @verdictShape("cursor-permission")
  beforeSubmitPrompt(input: CursorHookEnvelope): unknown;

  @hookEvent("beforeReadFile")
  @verdictShape("cursor-permission")
  beforeReadFile(input: CursorHookEnvelope): unknown;

  @hookEvent("beforeShellExecution")
  @verdictShape("cursor-permission")
  beforeShellExecution(input: CursorHookEnvelope): unknown;

  @hookEvent("beforeMCPExecution")
  @verdictShape("cursor-permission")
  beforeMCPExecution(input: CursorHookEnvelope): unknown;

  /**
   * Cursor 3.x's primary tool-routing hook. Cursor remaps Claude tool
   * names: Bash → "Shell", Write/Edit → "Write". Tools not listed
   * (`Glob`, `Grep`, etc.) are pass-through. Shell commands matching
   * `/\b(rm|unlink|rmdir|shred)\b/` reroute to file_write at runtime.
   */
  @hookEvent("preToolUse")
  @verdictShape("cursor-permission")
  @activityRouting(#{
    Read: "file_read",
    Write: "file_write",
    Shell: "agent_action",
  })
  preToolUse(input: CursorHookEnvelope): unknown;

  @hookEvent("afterAgentResponse")
  @verdictShape("cursor-observe")
  afterAgentResponse(input: CursorHookEnvelope): unknown;

  @hookEvent("afterAgentThought")
  @verdictShape("cursor-observe")
  afterAgentThought(input: CursorHookEnvelope): unknown;

  @hookEvent("afterShellExecution")
  @verdictShape("cursor-observe")
  afterShellExecution(input: CursorHookEnvelope): unknown;

  @hookEvent("afterFileEdit")
  @verdictShape("cursor-observe")
  afterFileEdit(input: CursorHookEnvelope): unknown;

  @hookEvent("afterMCPExecution")
  @verdictShape("cursor-observe")
  afterMCPExecution(input: CursorHookEnvelope): unknown;

  @hookEvent("postToolUse")
  @verdictShape("cursor-observe")
  postToolUse(input: CursorHookEnvelope): unknown;

  @hookEvent("postToolUseFailure")
  @verdictShape("cursor-observe")
  postToolUseFailure(input: CursorHookEnvelope): unknown;

  @hookEvent("sessionStart")
  @verdictShape("none")
  sessionStart(input: CursorHookEnvelope): unknown;

  @hookEvent("stop")
  @verdictShape("none")
  stop(input: CursorHookEnvelope): unknown;
}
