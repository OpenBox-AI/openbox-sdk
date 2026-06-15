# Claude Code Governance Surface

Audit date: 2026-06-15
Installed Claude Code version checked locally: `2.1.177 (Claude Code)`

Official sources used:

- `https://code.claude.com/docs/en/hooks`
- `https://code.claude.com/docs/en/plugins-reference`
- `https://code.claude.com/docs/en/plugins`
- `https://code.claude.com/docs/en/mcp`
- `https://code.claude.com/docs/en/skills`
- `https://code.claude.com/docs/en/settings`
- `https://code.claude.com/docs/en/tools-reference`
- `https://code.claude.com/docs/en/channels`
- `https://code.claude.com/docs/en/changelog`

Audited OpenBox SDK surfaces:

- `openbox-sdk/runtime/claude-code`
- `openbox-sdk/runtime/mcp`
- `openbox-sdk/runtime/cursor`
- `openbox-sdk/copilotkit`
- `openbox-sdk/copilotkit/react`
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
| `PostToolUse` | implement now | yes | `decision-block` |
| `PostToolUseFailure` | implement now | yes | `additional-context` |
| `PostToolBatch` | implement now | yes | `decision-block` |
| `SubagentStart` | observe only | yes | none |
| `SubagentStop` | implement now | yes | `decision-block` |
| `TaskCreated` | implement now | yes | `continue-block` |
| `TaskCompleted` | implement now | yes | `continue-block` |
| `Stop` | implement now | yes | `decision-block` |
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
| `SessionEnd` | observe only | yes | none |
| `Elicitation` | implement now | yes | `elicitation-response` |
| `ElicitationResult` | implement now | yes | `elicitation-response` |

`WorktreeCreate` is not installed by default because Claude Code documents it
as replacing default git worktree behavior. A safe OpenBox implementation would
need to actually create the worktree and return its absolute path.

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
| bin | diagnose only | OpenBox relies on the installed `openbox` binary; doctor reports command resolution. |
| managed settings | diagnose only | Enterprise managed settings are deployment policy, not SDK mutation. |
| channels | diagnose only | Channels are research preview; standard MCP remains the OpenBox connector path. |
| built-in tool permissions | implement now | Tool routing covers current built-in tool names and dynamic `mcp__*` tools. |

CopilotKit remains a separate reference adapter. Claude Code runtime behavior is
derived from the official Claude Code hook/plugin/MCP contract, not from
CopilotKit abstractions.
