# Claude Code Governance Surface

Audit date: 2026-06-17
Installed Claude Code version checked locally: `2.1.179 (Claude Code)`

Official sources used:

- `https://code.claude.com/docs/en/hooks`
- `https://code.claude.com/docs/en/plugins-reference`
- `https://code.claude.com/docs/en/plugins`
- `https://code.claude.com/docs/en/mcp`
- `https://code.claude.com/docs/en/skills`
- `https://code.claude.com/docs/en/commands`
- `https://code.claude.com/docs/en/agents`
- `https://code.claude.com/docs/en/settings`
- `https://code.claude.com/docs/en/tools-reference`
- `https://code.claude.com/docs/en/channels`
- `https://code.claude.com/docs/en/changelog`

Audited OpenBox SDK surfaces:

- `@openbox-ai/openbox-sdk/runtime/claude-code`
- `@openbox-ai/openbox-sdk/runtime/mcp`
- `@openbox-ai/openbox-sdk/runtime/cursor`
- `@openbox-ai/openbox-sdk/copilotkit`
- `@openbox-ai/openbox-sdk/copilotkit/react`
- `apps/extension`
- `skill/`
- `example/n8n`

## Hook Coverage

| Event | Classification | Default install | Decision surface |
|---|---|---:|---|
| `Setup` | observe only | yes | none |
| `SessionStart` | observe only | yes | none |
| `InstructionsLoaded` | observe only | yes | none |
| `UserPromptSubmit` | implement now | yes | `decision-block` |
| `UserPromptExpansion` | implement now | yes | `decision-block` |
| `MessageDisplay` | observe only | yes | none |
| `PreToolUse` | implement now | yes | `permission-decision` |
| `PermissionRequest` | implement now | yes | `permission-request` |
| `PermissionDenied` | implement now | yes | `permission-denied-retry` |
| `PostToolUse` | implement now | yes | `decision-block` + feedback |
| `PostToolUseFailure` | implement now | yes | `additional-context` |
| `PostToolBatch` | implement now | yes | `decision-block` + feedback |
| `SubagentStart` | observe only | yes | none |
| `SubagentStop` | implement now | yes | `decision-block` + feedback |
| `TaskCreated` | implement now | yes | `continue-block` |
| `TaskCompleted` | implement now | yes | `continue-block` |
| `Stop` | implement now | yes | `decision-block` + feedback |
| `StopFailure` | observe only | yes | none |
| `TeammateIdle` | implement now | yes | `continue-block` |
| `Notification` | observe only | yes | none |
| `ConfigChange` | implement now | yes | `decision-block` |
| `CwdChanged` | observe only | yes | none |
| `FileChanged` | observe only | yes | none |
| `WorktreeCreate` | explicit out of scope | no | worktree path |
| `WorktreeRemove` | observe only | yes | none |
| `PreCompact` | implement now | yes | `decision-block` |
| `PostCompact` | observe only | yes | none |
| `SessionEnd` | diagnose only | no | none |
| `Elicitation` | implement now | yes | `elicitation-response` |
| `ElicitationResult` | implement now | yes | `elicitation-response` |

`WorktreeCreate` is not installed by default because Claude Code documents it
as replacing default git worktree behavior. A safe OpenBox implementation would
need to actually create the worktree and return its absolute path.
`SessionEnd` is also opt-in: shutdown hooks can be cancelled before OpenBox
network telemetry reliably completes, so `Stop` is the default governed final
hook.

## Plugin And Connector Surfaces

| Surface | Classification | OpenBox treatment |
|---|---|---|
| hooks | implement now | Generated from TypeSpec and installed by the Claude Code plugin. |
| skills | implement now | Ships the OpenBox skill under `skills/openbox`. |
| commands | implement now | Ships slash-compatible command markdown files. |
| agents | implement now | Ships the OpenBox reviewer agent. |
| MCP | implement now | Exposes status, doctor, approvals, agents, policies, guardrails, and governance checks. |
| plugin settings | diagnose only | Claude Code currently supports only limited plugin settings; OpenBox reports this rather than mutating it. |
| monitors | diagnose only | Monitors are opt-in because they run unsandboxed and project-scope plugins do not load them. |
| LSP | explicit out of scope | OpenBox has no language server; official LSP plugins should be installed separately. |
| bin | implement now | Plugin ships a project-local Node runner for hooks, MCP, and diagnostics; no global OpenBox binary is required. |
| managed settings | diagnose only | Enterprise managed settings are deployment policy, not SDK mutation. |
| channels | diagnose only | Channels are research preview; standard MCP remains the OpenBox connector path. |
| built-in tool permissions | implement now | Tool routing covers current built-in tool names and dynamic `mcp__*` tools. |

CopilotKit remains a separate reference adapter. Claude Code runtime behavior is
derived from the official Claude Code hook/plugin/MCP contract, not from
CopilotKit abstractions.

## SDK Capability Coverage

| SDK capability | Claude Code treatment |
|---|---|
| Workflow start | `SessionStart` emits `WorkflowStarted`. |
| Workflow complete | `Stop` completes the workflow when Claude reports no background tasks; `SessionEnd` is opt-in shutdown telemetry. |
| Workflow failure | `StopFailure` records `WorkflowFailed` best-effort after observe telemetry. |
| Split-stage activities | `PreToolUse` opens an activity; `PostToolUse` and `PostToolUseFailure` close it with output, duration, and the same activity id when Claude supplies a stable tool id. |
| Single-stage gates | Prompts, permission requests, compaction, config changes, tasks, final output, subagent completion, and MCP elicitation use `session.activity(...)`. |
| Goal/signal telemetry | `UserPromptSubmit` emits `SignalReceived(user_prompt)` plus a prompt gate. |
| Approvals | Remote polling, inline `ask`, deferred approval, and fail-closed deny/block shapes are covered for decision-capable hooks. |
| Guardrail constrain/redaction | Claude-native output shapes carry updated input/output or additional context where the host protocol supports it. |
| Halt/block state | Decision hooks mark halted sessions and render Claude-native deny/block/continue-false responses. |
| Behavior-rule spans | Prompt, shell, file, HTTP, and MCP paths attach SDK spans for behavior-rule matching. |
| MCP connector | Plugin `.mcp.json` uses the bundled project-local runner for `mcp serve`, including `openbox_status`, `claude_code_doctor`, approvals, agents, policies, guardrails, and `check_governance`. |
| Plugin diagnostics | The plugin ships component inventory, governance matrix, SDK capability matrix, monitor opt-in metadata, a project-local bin runner, and a doctor shim. |
| Project-local config | Claude hooks read project `.claude-hooks/config.json` or `.env`; global Claude config is not mutated. |
| CopilotKit UI wrappers | Explicitly out of scope for Claude Code; Claude maps the same primitives through hooks/MCP instead. |
| Non-Claude SDK presets | Diagnose only; they remain SDK-wide capabilities, not Claude host surfaces. |
