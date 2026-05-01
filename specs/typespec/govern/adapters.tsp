// specs/typespec/govern/adapters.tsp; hook-protocol adapter shapes.
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
model ClaudeCodeEnvelope {
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
 * Claude Code hook adapter; single binary that dispatches every hook
 * event by `hook_event_name`. Binds to the `claude-code` preset.
 */
@adapter("claude-code", "claude-code", "hook_event_name")
@installTarget(#{
  file: "~/.claude/settings.json",
  key: "hooks",
  style: "claude-array",
  command: "openbox claude-code hook",
  configDir: "~/.claude-hooks",
})
interface ClaudeCodeAdapter {
  /**
   * PreToolUse: agent is about to call a tool. Routing by `tool_name`
   * to the appropriate activity_type lives in the @activityRouting
   * table; the per-tool payload field map lives in @payloadShape.
   *
   * Tools not listed (`Glob`, `Grep`, etc.) are pass-through (allow).
   * mcp__* tools resolve to MCPToolCall via runtime fallback.
   */
  @hookEvent("PreToolUse")
  @verdictShape("permission-decision")
  @installTimeout(86400)
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
  @payloadShape(#{
    default: #{
      tool_name: #{ from: "tool_name" },
      tool_input: #{ from: "tool_input" },
      event_category: #{ literal: "mcp_tool_call" },
    },
    byTool: #{
      Read: #{
        text: #{ sideEffect: "readFile", from: "tool_input.file_path" },
        file_path: #{ from: "tool_input.file_path", fallback: "tool_input.filePath" },
        content: #{ sideEffect: "readFile", from: "tool_input.file_path" },
        event_category: #{ literal: "file_read" },
      },
      Delete: #{
        text: #{ from: "tool_input.path", fallback: "tool_input.file_path" },
        file_path: #{ from: "tool_input.path", fallback: "tool_input.file_path" },
        event_category: #{ literal: "file_delete" },
      },
      Write: #{
        text: #{ from: "tool_input.content", fallback: "tool_input.new_string" },
        file_path: #{ from: "tool_input.file_path", fallback: "tool_input.filePath" },
        content: #{ from: "tool_input.content", fallback: "tool_input.new_string" },
        event_category: #{ literal: "file_write" },
      },
      Edit: #{
        text: #{ from: "tool_input.content", fallback: "tool_input.new_string" },
        file_path: #{ from: "tool_input.file_path", fallback: "tool_input.filePath" },
        content: #{ from: "tool_input.content", fallback: "tool_input.new_string" },
        event_category: #{ literal: "file_write" },
      },
      Bash: #{
        text: #{ from: "tool_input.command" },
        command: #{ from: "tool_input.command" },
        cwd: #{ from: "tool_input.cwd", fallback: "cwd" },
        event_category: #{ literal: "agent_action" },
      },
      WebFetch: #{
        url: #{ from: "tool_input.url", fallback: "tool_input.query" },
        http_method: #{ literal: "GET" },
        event_category: #{ literal: "http_request" },
      },
      WebSearch: #{
        url: #{ from: "tool_input.url", fallback: "tool_input.query" },
        http_method: #{ literal: "GET" },
        event_category: #{ literal: "http_request" },
      },
      Agent: #{
        agent_type: #{ from: "tool_input.subagent_type", fallback: "tool_input.description" },
        prompt: #{ from: "tool_input.prompt" },
        event_category: #{ literal: "agent_action" },
      },
    },
  })
  preToolUse(input: ClaudeCodeEnvelope): unknown;

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
  @payloadShape(#{
    default: #{
      tool_name: #{ from: "tool_name" },
      output: #{ sideEffect: "stringifyTruncate", from: "tool_output" },
      event_category: #{ literal: "agent_observation" },
    },
  })
  postToolUse(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("UserPromptSubmit")
  @verdictShape("decision-block")
  @installTimeout(86400)
  @payloadShape(#{
    default: #{
      text: #{ from: "prompt" },
      prompt: #{ from: "prompt" },
      `model`: #{ from: "model" },
      event_category: #{ literal: "llm_prompt" },
    },
  })
  userPromptSubmit(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("PermissionRequest")
  @verdictShape("permission-request")
  @installTimeout(86400)
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
  @payloadShape(#{
    default: #{
      tool_name: #{ from: "tool_name" },
      tool_input: #{ from: "tool_input" },
      event_category: #{ literal: "mcp_tool_call" },
    },
    byTool: #{
      Read: #{
        tool_name: #{ from: "tool_name" },
        tool_input: #{ from: "tool_input" },
        file_path: #{ from: "tool_input.file_path", fallback: "tool_input.filePath" },
        event_category: #{ literal: "file_read" },
      },
      Delete: #{
        tool_name: #{ from: "tool_name" },
        tool_input: #{ from: "tool_input" },
        file_path: #{ from: "tool_input.path", fallback: "tool_input.file_path" },
        event_category: #{ literal: "file_delete" },
      },
      Write: #{
        tool_name: #{ from: "tool_name" },
        tool_input: #{ from: "tool_input" },
        text: #{ from: "tool_input.content", fallback: "tool_input.new_string" },
        file_path: #{ from: "tool_input.file_path", fallback: "tool_input.filePath" },
        content: #{ from: "tool_input.content", fallback: "tool_input.new_string" },
        event_category: #{ literal: "file_write" },
      },
      Edit: #{
        tool_name: #{ from: "tool_name" },
        tool_input: #{ from: "tool_input" },
        text: #{ from: "tool_input.content", fallback: "tool_input.new_string" },
        file_path: #{ from: "tool_input.file_path", fallback: "tool_input.filePath" },
        content: #{ from: "tool_input.content", fallback: "tool_input.new_string" },
        event_category: #{ literal: "file_write" },
      },
      Bash: #{
        tool_name: #{ from: "tool_name" },
        tool_input: #{ from: "tool_input" },
        text: #{ from: "tool_input.command" },
        command: #{ from: "tool_input.command" },
        cwd: #{ from: "tool_input.cwd", fallback: "cwd" },
        event_category: #{ literal: "agent_action" },
      },
      WebFetch: #{
        tool_name: #{ from: "tool_name" },
        tool_input: #{ from: "tool_input" },
        url: #{ from: "tool_input.url", fallback: "tool_input.query" },
        http_method: #{ literal: "GET" },
        event_category: #{ literal: "http_request" },
      },
      WebSearch: #{
        tool_name: #{ from: "tool_name" },
        tool_input: #{ from: "tool_input" },
        url: #{ from: "tool_input.url", fallback: "tool_input.query" },
        http_method: #{ literal: "GET" },
        event_category: #{ literal: "http_request" },
      },
      Agent: #{
        tool_name: #{ from: "tool_name" },
        tool_input: #{ from: "tool_input" },
        event_category: #{ literal: "agent_action" },
      },
    },
  })
  permissionRequest(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("PreCompact")
  @verdictShape("none")
  @noPayload
  preCompact(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("SessionStart")
  @verdictShape("none")
  @payloadShape(#{
    default: #{
      status: #{ literal: "started" },
      cwd: #{ from: "cwd" },
      event_category: #{ literal: "workflow_start" },
    },
  })
  sessionStart(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("SessionEnd")
  @verdictShape("none")
  @payloadShape(#{
    default: #{
      status: #{ literal: "completed" },
      event_category: #{ literal: "workflow_complete" },
    },
  })
  sessionEnd(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("SubagentStart")
  @verdictShape("none")
  @payloadShape(#{
    default: #{
      agent_id: #{ from: "agent_id" },
      agent_type: #{ from: "agent_type" },
      event_category: #{ literal: "agent_action" },
    },
  })
  subagentStart(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("SubagentStop")
  @verdictShape("none")
  @payloadShape(#{
    default: #{
      agent_id: #{ from: "agent_id" },
      agent_type: #{ from: "agent_type" },
      status: #{ literal: "completed" },
      event_category: #{ literal: "agent_observation" },
    },
  })
  subagentStop(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("Stop")
  @verdictShape("none")
  @payloadShape(#{
    default: #{
      cwd: #{ from: "cwd" },
      event_category: #{ literal: "workflow_stop_request" },
    },
  })
  stop(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("Notification")
  @verdictShape("none")
  @noPayload
  notification(input: ClaudeCodeEnvelope): unknown;
}

// ---------------------------------------------------------------------------
// Cursor hook protocol
// ---------------------------------------------------------------------------

/**
 * Common stdin envelope Cursor writes for every hook. Like the Claude
 * envelope, per-event required fields differ; runtime validation lives
 * in the generated adapter module.
 */
model CursorEnvelope {
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
  /** beforeReadFile: Cursor inlines the file body in the envelope. */
  content?: string;
  /** afterMCPExecution legacy harness wire field; sometimes JSON-string-encoded. */
  result_json?: string;
}

/**
 * Cursor hook adapter; single binary that dispatches every Cursor hook
 * event by `hook_event_name`. Binds to the `cursor` preset.
 *
 * Cursor's `before*` hooks return `{permission, userMessage?, ...}` and
 * are governance gates; `after*` hooks are observational (telemetry only)
 * and return void. The verdictShape encodes which mapping the runtime uses.
 */
@adapter("cursor", "cursor", "hook_event_name")
@installTarget(#{
  file: "~/.cursor/hooks.json",
  key: "hooks",
  style: "cursor-keyed",
  command: "openbox cursor hook",
  configDir: "~/.cursor-hooks",
})
interface CursorAdapter {
  @hookEvent("beforeSubmitPrompt")
  @verdictShape("cursor-permission")
  @payloadShape(#{
    default: #{
      prompt: #{ from: "prompt" },
      generation_id: #{ from: "generation_id" },
      event_category: #{ literal: "llm_prompt" },
    },
  })
  beforeSubmitPrompt(input: CursorEnvelope): unknown;

  @hookEvent("beforeReadFile")
  @verdictShape("cursor-permission")
  @payloadShape(#{
    default: #{
      file_path: #{ from: "file_path" },
      content: #{ from: "content" },
      generation_id: #{ from: "generation_id" },
      event_category: #{ literal: "file_read" },
    },
  })
  beforeReadFile(input: CursorEnvelope): unknown;

  @hookEvent("beforeShellExecution")
  @verdictShape("cursor-permission")
  @payloadShape(#{
    default: #{
      command: #{ from: "command" },
      cwd: #{ from: "cwd" },
      generation_id: #{ from: "generation_id" },
      event_category: #{ literal: "agent_action" },
    },
  })
  beforeShellExecution(input: CursorEnvelope): unknown;

  @hookEvent("beforeMCPExecution")
  @verdictShape("cursor-permission")
  @payloadShape(#{
    default: #{
      tool_name: #{ from: "tool_name" },
      tool_input: #{ sideEffect: "stringify", from: "tool_input" },
      generation_id: #{ from: "generation_id" },
      event_category: #{ literal: "api_call" },
    },
  })
  beforeMCPExecution(input: CursorEnvelope): unknown;

  /**
   * Cursor 3.x's primary tool-routing hook. Cursor remaps Claude tool
   * names: Bash → "Shell", Write/Edit → "Write". Tools not listed
   * (`Glob`, `Grep`, etc.) are pass-through. Shell commands matching
   * `/\b(rm|unlink|rmdir|shred)\b/` reroute to file_write; declared
   * in the @activityVariant below; the runtime helper applies it
   * after the routing-table lookup.
   */
  @hookEvent("preToolUse")
  @verdictShape("cursor-permission")
  @activityRouting(#{
    Read: "file_read",
    Write: "file_write",
    Shell: "agent_action",
  })
  @activityVariant("Shell", #{
    field: "tool_input.command",
    pattern: "\\b(rm|unlink|rmdir|shred)\\b",
    activityType: "file_write",
    eventCategory: "file_delete",
  })
  @payloadShape(#{
    byTool: #{
      Read: #{
        file_path: #{ from: "tool_input.file_path", fallback: "tool_input.filePath" },
        content: #{ sideEffect: "readFile", from: "tool_input.file_path" },
        event_category: #{ literal: "file_read" },
      },
      Write: #{
        file_path: #{ from: "tool_input.file_path", fallback: "tool_input.filePath" },
        content: #{ from: "tool_input.content", fallback: "tool_input.new_string" },
        event_category: #{ literal: "file_write" },
      },
      Shell: #{
        command: #{ from: "tool_input.command" },
        cwd: #{ from: "tool_input.cwd", fallback: "cwd" },
        event_category: #{ literal: "agent_action" },
      },
    },
  })
  preToolUse(input: CursorEnvelope): unknown;

  @hookEvent("afterAgentResponse")
  @verdictShape("cursor-observe")
  @payloadShape(#{
    default: #{
      response: #{ from: "response" },
      generation_id: #{ from: "generation_id" },
      event_category: #{ literal: "llm_completion" },
    },
  })
  afterAgentResponse(input: CursorEnvelope): unknown;

  @hookEvent("afterAgentThought")
  @verdictShape("cursor-observe")
  @payloadShape(#{
    default: #{
      thought: #{ from: "thought" },
      generation_id: #{ from: "generation_id" },
      event_category: #{ literal: "agent_decision" },
    },
  })
  afterAgentThought(input: CursorEnvelope): unknown;

  @hookEvent("afterShellExecution")
  @verdictShape("cursor-observe")
  @payloadShape(#{
    default: #{
      command: #{ from: "command" },
      generation_id: #{ from: "generation_id" },
      event_category: #{ literal: "agent_observation" },
    },
  })
  afterShellExecution(input: CursorEnvelope): unknown;

  @hookEvent("afterFileEdit")
  @verdictShape("cursor-observe")
  @payloadShape(#{
    default: #{
      file_path: #{ from: "file_path" },
      generation_id: #{ from: "generation_id" },
      event_category: #{ literal: "file_write" },
    },
  })
  afterFileEdit(input: CursorEnvelope): unknown;

  @hookEvent("afterMCPExecution")
  @verdictShape("cursor-observe")
  @payloadShape(#{
    default: #{
      tool_name: #{ from: "tool_name" },
      tool_output: #{ sideEffect: "extractMcpText", from: "result_json", fallback: "tool_output" },
      generation_id: #{ from: "generation_id" },
      event_category: #{ literal: "agent_observation" },
    },
  })
  afterMCPExecution(input: CursorEnvelope): unknown;

  @hookEvent("postToolUse")
  @verdictShape("cursor-observe")
  @noPayload
  postToolUse(input: CursorEnvelope): unknown;

  @hookEvent("postToolUseFailure")
  @verdictShape("cursor-observe")
  @noPayload
  postToolUseFailure(input: CursorEnvelope): unknown;

  @hookEvent("sessionStart")
  @verdictShape("none")
  @payloadShape(#{
    default: #{
      status: #{ literal: "started" },
      event_category: #{ literal: "workflow_start" },
    },
  })
  sessionStart(input: CursorEnvelope): unknown;

  @hookEvent("stop")
  @verdictShape("none")
  @payloadShape(#{
    default: #{
      status: #{ literal: "completed" },
      event_category: #{ literal: "workflow_complete" },
    },
  })
  stop(input: CursorEnvelope): unknown;
}
