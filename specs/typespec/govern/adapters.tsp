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
  trigger?: string;
  source?: string;
  file_path?: string;
  event?: string;
  old_cwd?: string;
  new_cwd?: string;
  name?: string;
  command_name?: string;
  command_args?: string;
  expanded_prompt?: string;
  message?: string;
  display_content?: string;
  displayContent?: string;
  tool_response?: unknown;
  tool_calls?: unknown;
  error?: string;
  reason?: string;
  action?: string;
  content?: unknown;
  mcp_server_name?: string;
  mode?: string;
  url?: string;
  elicitation_id?: string;
  requested_schema?: unknown;
  response?: unknown;
  task_id?: string;
  task_subject?: string;
  task_description?: string;
  teammate_name?: string;
  team_name?: string;
  teammate_id?: string;
  team_id?: string;
  last_assistant_message?: string;
  background_tasks?: unknown;
  session_crons?: unknown;
  custom_instructions?: string;
  compact_summary?: string;
  compact?: unknown;
  instructions?: string;
}

/**
 * Claude Code hook adapter; single binary that dispatches every hook
 * event by `hook_event_name`. Binds to the `claude-code` preset.
 */
@adapter("claude-code", "claude-code", "hook_event_name")
@hookTarget(#{
  file: ".claude/settings.json",
  key: "hooks",
  style: "claude-array",
  command: "openbox claude-code hook",
  configDir: ".claude-hooks",
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
  @hookEventLabel("Tool call")
  @verdictShape("permission-decision")
  @installTimeout(86400)
  @activityRouting(#{
    Read: "FileRead",
    Write: "FileEdit",
    Edit: "FileEdit",
    Delete: "FileDelete",
    MultiEdit: "FileEdit",
    NotebookEdit: "FileEdit",
    NotebookRead: "FileRead",
    Glob: "FileRead",
    Grep: "FileRead",
    Bash: "ShellExecution",
    PowerShell: "ShellExecution",
    WebFetch: "HTTPRequest",
    WebSearch: "HTTPRequest",
    Agent: "AgentSpawn",
    Skill: "AgentAction",
    TodoWrite: "AgentAction",
    AskUserQuestion: "AgentAction",
    EnterPlanMode: "AgentAction",
    ExitPlanMode: "AgentAction",
    EnterWorktree: "AgentAction",
    CronCreate: "AgentAction",
    CronDelete: "AgentAction",
    CronList: "AgentAction",
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
      MultiEdit: #{
        text: #{ from: "tool_input.edits", fallback: "tool_input.content" },
        file_path: #{ from: "tool_input.file_path", fallback: "tool_input.filePath" },
        content: #{ from: "tool_input.edits", fallback: "tool_input.content" },
        event_category: #{ literal: "file_write" },
      },
      NotebookEdit: #{
        text: #{ from: "tool_input.new_source", fallback: "tool_input.content" },
        file_path: #{ from: "tool_input.notebook_path", fallback: "tool_input.file_path" },
        content: #{ from: "tool_input.new_source", fallback: "tool_input.content" },
        event_category: #{ literal: "file_write" },
      },
      NotebookRead: #{
        text: #{ sideEffect: "readFile", from: "tool_input.notebook_path" },
        file_path: #{ from: "tool_input.notebook_path", fallback: "tool_input.file_path" },
        content: #{ sideEffect: "readFile", from: "tool_input.notebook_path" },
        event_category: #{ literal: "file_read" },
      },
      Glob: #{
        text: #{ from: "tool_input.pattern" },
        file_path: #{ from: "tool_input.path", fallback: "cwd" },
        event_category: #{ literal: "file_read" },
      },
      Grep: #{
        text: #{ from: "tool_input.pattern" },
        file_path: #{ from: "tool_input.path", fallback: "cwd" },
        event_category: #{ literal: "file_read" },
      },
      Bash: #{
        text: #{ from: "tool_input.command" },
        command: #{ from: "tool_input.command" },
        cwd: #{ from: "tool_input.cwd", fallback: "cwd" },
        event_category: #{ literal: "agent_action" },
      },
      PowerShell: #{
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
      AskUserQuestion: #{
        text: #{ from: "tool_input.question", fallback: "tool_input.message" },
        event_category: #{ literal: "agent_action" },
      },
      ExitPlanMode: #{
        text: #{ from: "tool_input.plan" },
        event_category: #{ literal: "agent_action" },
      },
      Skill: #{
        tool_name: #{ from: "tool_name" },
        tool_input: #{ from: "tool_input" },
        event_category: #{ literal: "agent_action" },
      },
    },
  })
  preToolUse(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("PostToolUse")
  @hookEventLabel("Tool completion")
  @verdictShape("decision-block")
  @activityRouting(#{
    Read: "FileRead",
    Write: "FileEdit",
    Edit: "FileEdit",
    Delete: "FileDelete",
    MultiEdit: "FileEdit",
    NotebookEdit: "FileEdit",
    NotebookRead: "FileRead",
    Glob: "FileRead",
    Grep: "FileRead",
    Bash: "ShellExecution",
    PowerShell: "ShellExecution",
    WebFetch: "HTTPRequest",
    WebSearch: "HTTPRequest",
    Agent: "AgentSpawn",
    Skill: "AgentAction",
    TodoWrite: "AgentAction",
    AskUserQuestion: "AgentAction",
    EnterPlanMode: "AgentAction",
    ExitPlanMode: "AgentAction",
    EnterWorktree: "AgentAction",
    CronCreate: "AgentAction",
    CronDelete: "AgentAction",
    CronList: "AgentAction",
  })
  @payloadShape(#{
    default: #{
      tool_name: #{ from: "tool_name" },
      output: #{ sideEffect: "stringifyTruncate", from: "tool_output" },
      event_category: #{ literal: "agent_observation" },
    },
  })
  postToolUse(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("PostToolUseFailure")
  @hookEventLabel("Tool failure")
  @verdictShape("additional-context")
  @payloadShape(#{
    default: #{
      tool_name: #{ from: "tool_name" },
      tool_input: #{ from: "tool_input" },
      error: #{ from: "error", fallback: "reason" },
      event_category: #{ literal: "agent_observation" },
    },
  })
  postToolUseFailure(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("PostToolBatch")
  @hookEventLabel("Tool batch")
  @verdictShape("decision-block")
  @payloadShape(#{
    default: #{
      tool_calls: #{ from: "tool_calls" },
      output: #{ sideEffect: "stringifyTruncate", from: "tool_calls" },
      event_category: #{ literal: "agent_observation" },
    },
  })
  postToolBatch(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("UserPromptSubmit")
  @hookEventLabel("Prompt submission")
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

  @hookEvent("UserPromptExpansion")
  @hookEventLabel("Prompt expansion")
  @verdictShape("decision-block")
  @installTimeout(86400)
  @payloadShape(#{
    default: #{
      text: #{ from: "expanded_prompt", fallback: "prompt" },
      prompt: #{ from: "expanded_prompt", fallback: "prompt" },
      command_name: #{ from: "command_name" },
      command_args: #{ from: "command_args" },
      event_category: #{ literal: "llm_prompt" },
    },
  })
  userPromptExpansion(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("PermissionRequest")
  @hookEventLabel("Permission request")
  @verdictShape("permission-request")
  @installTimeout(86400)
  @activityRouting(#{
    Read: "FileRead",
    Write: "FileEdit",
    Edit: "FileEdit",
    Delete: "FileDelete",
    MultiEdit: "FileEdit",
    NotebookEdit: "FileEdit",
    NotebookRead: "FileRead",
    Glob: "FileRead",
    Grep: "FileRead",
    Bash: "ShellExecution",
    PowerShell: "ShellExecution",
    WebFetch: "HTTPRequest",
    WebSearch: "HTTPRequest",
    Agent: "AgentSpawn",
    Skill: "AgentAction",
    TodoWrite: "AgentAction",
    AskUserQuestion: "AgentAction",
    EnterPlanMode: "AgentAction",
    ExitPlanMode: "AgentAction",
    EnterWorktree: "AgentAction",
    CronCreate: "AgentAction",
    CronDelete: "AgentAction",
    CronList: "AgentAction",
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

  @hookEvent("PermissionDenied")
  @hookEventLabel("Permission denied")
  @verdictShape("permission-denied-retry")
  @payloadShape(#{
    default: #{
      tool_name: #{ from: "tool_name" },
      tool_input: #{ from: "tool_input" },
      reason: #{ from: "reason" },
      event_category: #{ literal: "agent_action" },
    },
  })
  permissionDenied(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("Setup")
  @hookEventLabel("Setup")
  @verdictShape("none")
  @payloadShape(#{
    default: #{
      trigger: #{ from: "trigger" },
      event_category: #{ literal: "workflow_start" },
    },
  })
  setup(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("InstructionsLoaded")
  @hookEventLabel("Instructions loaded")
  @verdictShape("none")
  @payloadShape(#{
    default: #{
      source: #{ from: "source" },
      instructions: #{ from: "instructions" },
      event_category: #{ literal: "agent_observation" },
    },
  })
  instructionsLoaded(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("PreCompact")
  @hookEventLabel("Pre-compact")
  @verdictShape("decision-block")
  @payloadShape(#{
    default: #{
      trigger: #{ from: "trigger" },
      custom_instructions: #{ from: "custom_instructions" },
      event_category: #{ literal: "workflow_compact" },
    },
  })
  preCompact(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("PostCompact")
  @hookEventLabel("Post-compact")
  @verdictShape("none")
  @payloadShape(#{
    default: #{
      compact_summary: #{ from: "compact_summary" },
      event_category: #{ literal: "workflow_compact" },
    },
  })
  postCompact(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("SessionStart")
  @hookEventLabel("Session start")
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
  @hookEventLabel("Session end")
  @verdictShape("none")
  @payloadShape(#{
    default: #{
      status: #{ literal: "completed" },
      event_category: #{ literal: "workflow_complete" },
    },
  })
  sessionEnd(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("SubagentStart")
  @hookEventLabel("Subagent spawn")
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
  @hookEventLabel("Subagent stop")
  @verdictShape("decision-block")
  @payloadShape(#{
    default: #{
      agent_id: #{ from: "agent_id" },
      agent_type: #{ from: "agent_type" },
      status: #{ literal: "completed" },
      event_category: #{ literal: "agent_observation" },
    },
  })
  subagentStop(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("TaskCreated")
  @hookEventLabel("Task created")
  @verdictShape("continue-block")
  @payloadShape(#{
    default: #{
      task_id: #{ from: "task_id" },
      task_subject: #{ from: "task_subject" },
      task_description: #{ from: "task_description" },
      teammate_name: #{ from: "teammate_name" },
      team_name: #{ from: "team_name" },
      event_category: #{ literal: "agent_action" },
    },
  })
  taskCreated(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("TaskCompleted")
  @hookEventLabel("Task completed")
  @verdictShape("continue-block")
  @payloadShape(#{
    default: #{
      task_id: #{ from: "task_id" },
      task_subject: #{ from: "task_subject" },
      task_description: #{ from: "task_description" },
      teammate_name: #{ from: "teammate_name" },
      team_name: #{ from: "team_name" },
      event_category: #{ literal: "agent_observation" },
    },
  })
  taskCompleted(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("Stop")
  @hookEventLabel("Stop")
  @verdictShape("decision-block")
  @payloadShape(#{
    default: #{
      cwd: #{ from: "cwd" },
      last_assistant_message: #{ from: "last_assistant_message" },
      background_tasks: #{ from: "background_tasks" },
      session_crons: #{ from: "session_crons" },
      event_category: #{ literal: "workflow_stop_request" },
    },
  })
  stop(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("StopFailure")
  @hookEventLabel("Stop failure")
  @verdictShape("none")
  @payloadShape(#{
    default: #{
      error: #{ from: "error", fallback: "reason" },
      event_category: #{ literal: "workflow_failed" },
    },
  })
  stopFailure(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("TeammateIdle")
  @hookEventLabel("Teammate idle")
  @verdictShape("continue-block")
  @payloadShape(#{
    default: #{
      teammate_name: #{ from: "teammate_name" },
      team_name: #{ from: "team_name" },
      event_category: #{ literal: "agent_observation" },
    },
  })
  teammateIdle(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("Notification")
  @hookEventLabel("Notification")
  @verdictShape("none")
  @payloadShape(#{
    default: #{
      message: #{ from: "message" },
      event_category: #{ literal: "agent_observation" },
    },
  })
  notification(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("MessageDisplay")
  @hookEventLabel("Message display")
  @verdictShape("none")
  @payloadShape(#{
    default: #{
      message: #{ from: "message", fallback: "display_content" },
      display_content: #{ from: "display_content", fallback: "displayContent" },
      event_category: #{ literal: "llm_output" },
    },
  })
  messageDisplay(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("ConfigChange")
  @hookEventLabel("Config change")
  @verdictShape("decision-block")
  @payloadShape(#{
    default: #{
      source: #{ from: "source" },
      file_path: #{ from: "file_path" },
      event_category: #{ literal: "configuration_change" },
    },
  })
  configChange(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("CwdChanged")
  @hookEventLabel("CWD changed")
  @verdictShape("none")
  @payloadShape(#{
    default: #{
      old_cwd: #{ from: "old_cwd" },
      new_cwd: #{ from: "new_cwd" },
      event_category: #{ literal: "workspace_change" },
    },
  })
  cwdChanged(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("FileChanged")
  @hookEventLabel("File changed")
  @verdictShape("none")
  @payloadShape(#{
    default: #{
      file_path: #{ from: "file_path" },
      event: #{ from: "event" },
      event_category: #{ literal: "file_change" },
    },
  })
  fileChanged(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("WorktreeRemove")
  @hookEventLabel("Worktree remove")
  @verdictShape("none")
  @payloadShape(#{
    default: #{
      name: #{ from: "name" },
      cwd: #{ from: "cwd" },
      event_category: #{ literal: "workspace_change" },
    },
  })
  worktreeRemove(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("Elicitation")
  @hookEventLabel("MCP elicitation")
  @verdictShape("elicitation-response")
  @installTimeout(86400)
  @payloadShape(#{
    default: #{
      mcp_server_name: #{ from: "mcp_server_name" },
      message: #{ from: "message" },
      mode: #{ from: "mode" },
      url: #{ from: "url" },
      requested_schema: #{ from: "requested_schema" },
      event_category: #{ literal: "mcp_elicitation" },
    },
  })
  elicitation(input: ClaudeCodeEnvelope): unknown;

  @hookEvent("ElicitationResult")
  @hookEventLabel("MCP elicitation result")
  @verdictShape("elicitation-response")
  @payloadShape(#{
    default: #{
      mcp_server_name: #{ from: "mcp_server_name" },
      action: #{ from: "action" },
      content: #{ from: "content" },
      mode: #{ from: "mode" },
      event_category: #{ literal: "mcp_elicitation_result" },
    },
  })
  elicitationResult(input: ClaudeCodeEnvelope): unknown;
}

// ---------------------------------------------------------------------------
// Cursor hook protocol
// ---------------------------------------------------------------------------
//
// CANONICAL SOURCE: https://cursor.com/docs/hooks (cursor.com docs are
// the only authoritative spec; there is no per-version pin or OpenAPI
// document published by Cursor). Last verified 2026-05-09.
//
// Verdict-shape contract per Cursor docs:
//   * `before*` permission hooks (beforeReadFile / beforeShellExecution
//     / beforeMCPExecution): stdout `{ permission: "allow"|"deny"|"ask",
//     user_message?: string }`. Field names are **snake_case**;
//     emitting `userMessage` silently no-ops the user-facing message.
//   * `beforeSubmitPrompt`: distinct shape; stdout `{ continue: bool,
//     user_message?: string, agent_message?: string }`. Cursor does NOT
//     accept `permission` here; emitting it causes the prompt to fall
//     through ungoverned.
//   * `after*` observe hooks: stdout `{}`; telemetry-only.
//
// Drift guards downstream: tests/contract/cursor-hook-contract.test.ts
// asserts each event's stdout JSON shape; tests/unit/cursor-activity-type-drift.test.ts
// asserts spec @activityType ↔ runtime mapper parity.
//
// Two distinct vocabularies are at play here:
//
//   1. `activity_type`; free-form indexing string the backend persists
//      and the dashboard renders. PascalCase canonical labels
//      (`PromptSubmission`, `FileRead`, `ShellExecution`, ...) so the
//      `@activityLabels` table can render them; this is what the
//      `@activityType` decorator drives.
//
//   2. Span `semantic_type` + classifier gate attributes; the actual
//      input to behavior-rule matching. Core's classifier reads each
//      span (HTTP method/url, file.path/operation, db.system, gen_ai.system,
//      shell.command) and resolves one of 19 trigger values (snake_case;
//      file_read, file_write, file_delete, http_post, llm_completion,
//      llm_tool_call, internal, ...; see `skill/references/behaviors.md`).
//      Behavior rules MATCH against this trigger, NOT against `activity_type`.
//
// Without spans on the wire, the classifier has nothing to read, so
// behavior rules silently never fire and every evaluate falls through to
// default-allow with `policy_id="00000000-0000-0000-0000-000000000000"`.
// Each cursor mapper builds a span via runtime/cursor/span-builder.ts
// and passes it through `session.activity({ input, spans })`.
// See `skill/references/span-reference.md` for the canonical span shape
// per semantic type.

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
  /**
   * The IDE's open workspace folders, sent on every hook envelope per
   * cursor.com/docs/hooks. Used by the runtime to decide "is this
   * file action inside the project?"; reads inside any root skip
   * governance evaluate (silent allow); reads outside trigger normal
   * behavior-rule matching (typically `file_read` → require_approval).
   */
  workspace_roots?: string[];
  /** subagentStart: model the parent agent is delegating to. */
  subagent_model?: string;
  /** subagentStart: tool-call id that triggered the subagent creation. */
  tool_call_id?: string;
  /** subagentStart: unique identifier for the subagent instance. */
  subagent_id?: string;
  /** subagentStart: subagent classifier (e.g. "general-purpose", "code-reviewer"). */
  subagent_type?: string;
  /** subagentStart: the prompt/task the parent is delegating. */
  task?: string;
  /** subagentStart: parent's conversation id for cross-reference. */
  parent_conversation_id?: string;
  /** subagentStart: true if running in a parallel worker rather than serial. */
  is_parallel_worker?: boolean;
  /** subagentStart: git worktree branch (when Cursor is sandboxing the subagent). */
  git_branch?: string;
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
@hookTarget(#{
  file: ".cursor/hooks.json",
  key: "hooks",
  style: "cursor-keyed",
  command: "openbox cursor hook",
  configDir: ".cursor-hooks",
})
interface CursorAdapter {
  @hookEvent("beforeSubmitPrompt")
  @hookEventLabel("Prompt submission")
  @verdictShape("cursor-continue")
  @installTimeout(1800)
  @activityType("PromptSubmission")
  @payloadShape(#{
    default: #{
      prompt: #{ from: "prompt" },
      generation_id: #{ from: "generation_id" },
      event_category: #{ literal: "llm_prompt" },
    },
  })
  beforeSubmitPrompt(input: CursorEnvelope): unknown;

  @hookEvent("beforeReadFile")
  @hookEventLabel("File read")
  @verdictShape("cursor-permission")
  @installTimeout(1800)
  @activityType("FileRead")
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
  @hookEventLabel("Shell command")
  @verdictShape("cursor-permission")
  @installTimeout(1800)
  @activityType("ShellExecution")
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
  @hookEventLabel("MCP tool call")
  @verdictShape("cursor-permission")
  @installTimeout(1800)
  @activityType("MCPToolCall")
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
  @hookEventLabel("Tool call")
  @verdictShape("cursor-permission")
  @installTimeout(1800)
  @activityRouting(#{
    Read: "FileRead",
    Write: "FileEdit",
    Shell: "ShellExecution",
  })
  @activityVariant("Shell", #{
    field: "tool_input.command",
    pattern: "\\b(rm|unlink|rmdir|shred)\\b",
    activityType: "FileDelete",
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
  @hookEventLabel("Agent response")
  @verdictShape("cursor-observe")
  @activityType("LLMCompleted")
  @payloadShape(#{
    default: #{
      response: #{ from: "response" },
      generation_id: #{ from: "generation_id" },
      event_category: #{ literal: "llm_completion" },
    },
  })
  afterAgentResponse(input: CursorEnvelope): unknown;

  @hookEvent("afterAgentThought")
  @hookEventLabel("Agent thought")
  @verdictShape("cursor-observe")
  @activityType("LLMCompleted")
  @payloadShape(#{
    default: #{
      thought: #{ from: "thought" },
      generation_id: #{ from: "generation_id" },
      event_category: #{ literal: "agent_decision" },
    },
  })
  afterAgentThought(input: CursorEnvelope): unknown;

  @hookEvent("afterShellExecution")
  @hookEventLabel("Shell completion")
  @verdictShape("cursor-observe")
  @activityType("ShellExecution")
  @payloadShape(#{
    default: #{
      command: #{ from: "command" },
      generation_id: #{ from: "generation_id" },
      event_category: #{ literal: "agent_observation" },
    },
  })
  afterShellExecution(input: CursorEnvelope): unknown;

  @hookEvent("afterFileEdit")
  @hookEventLabel("File edit")
  @verdictShape("cursor-observe")
  @activityType("FileEdit")
  @payloadShape(#{
    default: #{
      file_path: #{ from: "file_path" },
      generation_id: #{ from: "generation_id" },
      event_category: #{ literal: "file_write" },
    },
  })
  afterFileEdit(input: CursorEnvelope): unknown;

  @hookEvent("afterMCPExecution")
  @hookEventLabel("MCP completion")
  @verdictShape("cursor-observe")
  @activityType("MCPToolCall")
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
  @hookEventLabel("Tool completion")
  @verdictShape("cursor-observe")
  @noPayload
  postToolUse(input: CursorEnvelope): unknown;

  @hookEvent("postToolUseFailure")
  @hookEventLabel("Tool failure")
  @verdictShape("cursor-observe")
  @noPayload
  postToolUseFailure(input: CursorEnvelope): unknown;

  @hookEvent("sessionStart")
  @hookEventLabel("Session start")
  @verdictShape("none")
  @payloadShape(#{
    default: #{
      status: #{ literal: "started" },
      event_category: #{ literal: "workflow_start" },
    },
  })
  sessionStart(input: CursorEnvelope): unknown;

  @hookEvent("stop")
  @hookEventLabel("Stop")
  @verdictShape("none")
  @payloadShape(#{
    default: #{
      status: #{ literal: "completed" },
      event_category: #{ literal: "workflow_complete" },
    },
  })
  stop(input: CursorEnvelope): unknown;

  /**
   * Cursor fires this when the user opens a file by clicking a tab
   * (not via an agent tool call). Validator accepts only "allow" /
   * "deny" (no "ask"). Useful for governing reads of sensitive files
   * the agent didn't request but happened to be in the workspace.
   */
  @hookEvent("beforeTabFileRead")
  @hookEventLabel("Tab file read")
  @verdictShape("cursor-permission")
  @installTimeout(1800)
  @activityType("FileRead")
  @payloadShape(#{
    default: #{
      file_path: #{ from: "file_path" },
      content: #{ from: "content" },
      generation_id: #{ from: "generation_id" },
      event_category: #{ literal: "file_read" },
    },
  })
  beforeTabFileRead(input: CursorEnvelope): unknown;

  /** Observe-only completion signal for tab-driven file edits. */
  @hookEvent("afterTabFileEdit")
  @hookEventLabel("Tab file edit")
  @verdictShape("cursor-observe")
  @activityType("FileEdit")
  @payloadShape(#{
    default: #{
      file_path: #{ from: "file_path" },
      generation_id: #{ from: "generation_id" },
      event_category: #{ literal: "file_write" },
    },
  })
  afterTabFileEdit(input: CursorEnvelope): unknown;

  /** Cursor's session close (distinct from `stop`, which fires on chat-turn boundary). */
  @hookEvent("sessionEnd")
  @hookEventLabel("Session end")
  @verdictShape("none")
  @payloadShape(#{
    default: #{
      status: #{ literal: "completed" },
      event_category: #{ literal: "workflow_complete" },
    },
  })
  sessionEnd(input: CursorEnvelope): unknown;

  /** Pre-context-compact; observe-only. */
  @hookEvent("preCompact")
  @hookEventLabel("Pre-compact")
  @verdictShape("cursor-observe")
  @noPayload
  preCompact(input: CursorEnvelope): unknown;

  /**
   * Cursor's multi-agent boundary. As of this writing, this is the
   * only event where Cursor has a hardcoded chat wrapper string
   * ("Subagent creation blocked by hook: <user_message>") and the
   * only event whose validator stubs `permission: "ask"` (currently
   * throws). Returning `permission: "deny"` blocks subagent
   * creation; the user_message surfaces in the chat verbatim.
   */
  @hookEvent("subagentStart")
  @hookEventLabel("Subagent spawn")
  @verdictShape("cursor-permission")
  @installTimeout(1800)
  @activityType("SubagentStart")
  @payloadShape(#{
    default: #{
      subagent_id: #{ from: "subagent_id" },
      subagent_type: #{ from: "subagent_type" },
      subagent_model: #{ from: "subagent_model" },
      task: #{ from: "task" },
      tool_call_id: #{ from: "tool_call_id" },
      parent_conversation_id: #{ from: "parent_conversation_id" },
      is_parallel_worker: #{ from: "is_parallel_worker" },
      git_branch: #{ from: "git_branch" },
      generation_id: #{ from: "generation_id" },
      event_category: #{ literal: "agent_action" },
    },
  })
  subagentStart(input: CursorEnvelope): unknown;

  /** Observe-only subagent close. */
  @hookEvent("subagentStop")
  @hookEventLabel("Subagent stop")
  @verdictShape("cursor-observe")
  @noPayload
  subagentStop(input: CursorEnvelope): unknown;
}
