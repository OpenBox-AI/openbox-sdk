<!-- TODO: post-monorepo-consolidation rewrite. References below describe the standalone repos; the consolidated openbox-sdk has the same surface under openbox-sdk/runtime/<x> sub-paths and openbox-sdk CLI subcommands. -->
# Claude Code Hooks Reference

`claude-hooks` provides real-time governance by intercepting Claude Code agent actions via the hooks system.

- Repo: `github.com/OpenBox-AI/openbox-sdk`
- Handler: `dist/hook-handler.js` (compiled from `src/hook-handler.ts`)
- Config: `~/.claude-hooks/config.json` (contains `OPENBOX_API_KEY`)
- Hook registration: `~/.claude/settings.json`

## Claude Code Hook Events

| Hook | Blocking? | What it governs |
|------|-----------|-----------------|
| `SessionStart` | No | Initialize governance workflow |
| `UserPromptSubmit` | Yes | Prompt text - guardrails (PII, toxicity, ban words) |
| `PreToolUse` | Yes | ALL tool calls - routes by `tool_name` to governance |
| `PostToolUse` | No | Tool output - guardrails, trust scoring |
| `PostToolUseFailure` | No | Tool failure output - handled same as PostToolUse |
| `SessionEnd` / `Stop` | No | Session end - trust scoring, drift detection |
| `SubagentStart` | No | Subagent spawn tracking |
| `SubagentStop` | No | Subagent completion tracking |

## Workflow Lifecycle (Temporal-like)

Every session follows proper Temporal workflow semantics. Activities are always paired Start → Complete.

```
SessionStart
  → WorkflowStarted
  → ActivityStarted(ClaudeCodeSession)

UserPromptSubmit
  → SignalReceived (goal for drift detection)
  → ActivityStarted(PromptSubmission) - input governance
  → ActivityCompleted(PromptSubmission) - always, blocked or allowed

PreToolUse (per tool call)
  → ActivityStarted(FileRead/FileEdit/FileDelete/Shell/HTTP/MCP/AgentSpawn)
  → ActivityCompleted only if blocked (allowed waits for PostToolUse)

PostToolUse (per tool call)
  → ActivityCompleted - closes PreToolUse activity + output governance

SubagentStart
  → ActivityStarted(SubAgent:type)

SubagentStop
  → ActivityCompleted(SubAgent:type)

SessionEnd
  → ActivityCompleted(ClaudeCodeSession) - closes SessionStart activity
  → WorkflowCompleted - AGE drift check, trust scoring
```

## Tool Routing (PreToolUse)

| Tool | Activity Type | Semantic Type | Event Category |
|------|---------------|---------------|----------------|
| `Read` | FileRead | file_read | file_read |
| `Write` / `Edit` | FileEdit | file_write | file_write |
| `Delete` | FileDelete | file_delete | file_delete |
| `Bash` | ShellExecution | internal | agent_action |
| `WebFetch` / `WebSearch` | HTTPRequest | http_request | http_request |
| `Agent` | AgentSpawn | internal | agent_action |
| `mcp__*` | MCPToolCall | llm_tool_call | mcp_tool_call |
| `Glob` / `Grep` | Skipped | - | - |

Skip list is configurable via `SKIP_TOOLS` in config.

## Halt Recovery

When the OpenBox API halts a workflow (e.g., banned words triggered):
1. The blocked activity is completed with error status
2. `WorkflowCompleted` is sent to properly close the dead workflow
3. The workflow is marked `halted: true` in the session store
4. The next activity creates a fresh workflow with new IDs
5. The fresh activity is evaluated on its own merits

This prevents a single block from permanently breaking the session.

## Installation

```bash
cd claude-hooks
npm install && npm run build
npx tsx scripts/install.ts
```

The install script creates:
- Entries in `~/.claude/settings.json` under `hooks`
- `~/.claude-hooks/config.json` - example config with `DRY_RUN: true`

**Installed hooks** (5): `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`. Blocking hooks (`PreToolUse`, `UserPromptSubmit`) get `timeout: 86400` for HITL approval waits.

**Supported but not installed by default** (3): `PostToolUseFailure`, `SubagentStart`, `SubagentStop`. The handler processes them if registered, but the install script doesn't add them. To enable, manually add entries to `~/.claude/settings.json`.

To uninstall: `npx tsx scripts/install.ts --uninstall`

## Configuration (`~/.claude-hooks/config.json`)

Full example (all 17 supported keys):

```json
{
  "OPENBOX_API_KEY": "obx_live_...",
  "OPENBOX_ENDPOINT": "https://core.openbox.ai",
  "GOVERNANCE_POLICY": "fail_open",
  "GOVERNANCE_TIMEOUT": 15,
  "HITL_ENABLED": true,
  "HITL_MAX_WAIT": 300,
  "HITL_POLL_INTERVAL": 5,
  "VERBOSE": false,
  "DRY_RUN": false,
  "SKIP_TOOLS": "Glob,Grep",
  "SKIP_ACTIVITY_TYPES": "",
  "SEND_START_EVENT": true,
  "SEND_ACTIVITY_START_EVENT": true,
  "MAX_BODY_SIZE": null,
  "TASK_QUEUE": "claude-code",
  "SESSION_DIR": "~/.claude-hooks/sessions",
  "LOG_FILE": "~/.claude-hooks/hook.log"
}
```

What the install script actually writes (`scripts/install.ts`) is a shorter 8-key starter with `DRY_RUN: true` so initial runs are observational. The additional keys above are supported by `src/config.ts` and can be added manually.

- `GOVERNANCE_POLICY`: `fail_open` (allow on API errors) or `fail_closed` (block on API errors)
- `GOVERNANCE_TIMEOUT`: seconds before API request timeout (default 15)
- `HITL_MAX_WAIT`: seconds the handler polls for approval (default 300)
- `DRY_RUN`: log but don't enforce - all hooks return allow (install default `true`)
- `SKIP_TOOLS`: comma-separated tool names to skip governance (default: Glob,Grep)
- `SKIP_ACTIVITY_TYPES`: comma-separated activity types to skip governance
- `SEND_START_EVENT` / `SEND_ACTIVITY_START_EVENT`: control whether WorkflowStarted/ActivityStarted events are sent
- `MAX_BODY_SIZE`: optional limit on request body size (null = unlimited)
- `SESSION_DIR`: override for the session-store location (default `~/.claude-hooks/sessions`)
- `LOG_FILE`: override for the JSON-lines log path (default `~/.claude-hooks/hook.log`)

Config loading priority: environment variables > `config.json` > `.env` file. Both camelCase and UPPER_SNAKE_CASE keys work in JSON config.

## Debugging

Hook handler writes to stderr (visible in Claude Code's hook output) when `VERBOSE: true`.

Log file: `~/.claude-hooks/hook.log` (JSON lines, one per event).

Test a hook manually:
```bash
echo '{"hook_event_name":"UserPromptSubmit","session_id":"test","prompt":"hello","cwd":"/tmp"}' | node dist/hook-handler.js
```

## Session Store

Sessions are stored as JSON files in `~/.claude-hooks/sessions/` (configurable via `SESSION_DIR`). Each session tracks workflow IDs, activity IDs, halted state, and span context.

Auto-cleanup: session files older than 24 hours are removed on startup to prevent unbounded disk growth.

The `governanceMetadata` field added internally by verdict mappers is stripped from stdout output before it reaches Claude Code - only the hook response fields (`hookSpecificOutput`, `decision`, etc.) are emitted.

## Differences from Cursor Hooks

| Aspect | Claude Code | Cursor |
|--------|-------------|--------|
| Hook registration | `~/.claude/settings.json` | `~/.cursor/hooks.json` |
| Config location | `~/.claude-hooks/` | `~/.cursor-hooks/` |
| Tool name for shell | `Bash` | `Shell` |
| Tool name for edit | `Edit` (separate from Write) | `Write` (Edit maps to Write) |
| Delete tool | Supported (`Delete`) | Not dispatched by Cursor |
| PreToolUse response | `{ hookSpecificOutput: { permissionDecision: "allow"/"deny" } }` | `{ permission: "allow"/"deny" }` |
| UserPromptSubmit response | `{ decision: "block", reason: "..." }` | N/A (uses `beforeSubmitPrompt`) |
| Hook timeout | Set in `settings.json` per hook | Set in `hooks.json` per hook |
