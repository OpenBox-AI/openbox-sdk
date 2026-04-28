<!-- TODO: post-monorepo-consolidation rewrite. References below describe the standalone repos; the consolidated openbox-sdk has the same surface under openbox-sdk/runtime/<x> sub-paths and openbox-sdk CLI subcommands. -->
# Cursor Hooks Reference

cursor-hooks provides real-time governance by intercepting Cursor agent actions before execution.

- Repo: `github.com/OpenBox-AI/openbox-sdk`
- Handler: `~/.cursor-hooks/hook-handler.js`
- Config: `~/.cursor-hooks/config.json` (contains `OPENBOX_API_KEY`)
- Hook registration: `~/.cursor/hooks.json`

## Cursor 3.x Hook Reality

Verified against Cursor 3.0.12 source (`workbench.desktop.main.js`).

### Hooks that fire for agent actions

| Hook | Dispatch path | Blocking? | What cursor-hooks does with it |
|------|--------------|-----------|--------------------------------|
| `beforeSubmitPrompt` | Composer + cmd-k | Yes | Prompt text - guardrails (PII, toxicity, ban words), OPA policy, behavioral rules |
| `preToolUse` | agent-exec via IPC | Yes | ALL agent tool calls - routes by `tool_name` to appropriate governance |
| `beforeShellExecution` | agent-exec via IPC | Yes | Shell commands - behavioral rules, OPA policy |
| `afterAgentResponse` | Composer + cmd-k | No | Observe LLM output - trust scoring, drift detection |
| `afterAgentThought` | Composer | No | Observe agent reasoning - drift detection |
| `afterShellExecution` | agent-exec via IPC | No | Observe shell output |
| `afterMCPExecution` | agent-exec via IPC | No | Observe MCP output |
| `afterFileEdit` | cmd-k only | No | Observe cmd-k file edits (agent edits go via postToolUse) |
| `stop` | Composer + cmd-k | No | Session end - trust scoring, attestation |
| `sessionStart` | Composer | No | Session begin - initialize governance session |
| `postToolUse` | agent-exec via IPC | No | Registered but handler body is empty (`break;`). Planned for trust scoring / tool-output observation; currently no-op. |

**Not handled by cursor-hooks** (even if Cursor dispatches them): `sessionEnd`, `subagentStart`, `subagentStop`. The source has no case in the handler switch and no registration in `install.ts`. If you need session-end behavior, `stop` is the hook that actually fires.

### Hooks that do NOT fire for agent actions

| Hook | Actually fires from | Notes |
|------|-------------------|-------|
| `beforeReadFile` | **cmd-k (inline edit) only** | 1 call site, in cmd-k handler. Agent file reads go through `preToolUse` with `tool_name: "Read"` instead. |
| `afterFileEdit` | **cmd-k only** | Agent file edits go through `postToolUse` with `tool_name: "Write"/"Edit"` |
| `beforeTabFileRead` | Tab completion | Not agent-related |
| `afterTabFileEdit` | Tab completion | Not agent-related |
| `beforeMCPExecution` | **0 call sites found** | Registered in enum but never dispatched in current Cursor |
| `preCompact` | **0 call sites found** | Not dispatched |
| `postToolUseFailure` | **0 call sites found** | Registered but not dispatched |

### preToolUse - the primary agent governance hook

`preToolUse` fires for every tool the agent invokes. It's dispatched from the `agent-exec` package via IPC (not `cursorHooksService.executeHookForStep`).

**Input payload:**
```json
{
  "hook_event_name": "preToolUse",
  "tool_name": "Read",
  "tool_input": { "file_path": "/path/to/file" },
  "tool_use_id": "uuid",
  "cwd": "/workspace",
  "conversation_id": "uuid",
  "generation_id": "uuid",
  "model": "claude-sonnet-4-20250514"
}
```

**Tool name mapping** (from Cursor source `claude-code-types.ts`). Note: Cursor's agent sends `Shell` as the tool name for shell execution - it does NOT also send `Bash`. The cursor-hooks `preToolUse` mapper matches on `"Shell"` exactly; handling `"Bash"` too is a claude-hooks thing, not a cursor-hooks one.

| Cursor tool | `tool_name` value |
|-------------|-------------------|
| Shell (agent shell exec) | `Shell` |
| Read | `Read` |
| Write | `Write` |
| Edit | `Write` |
| Grep | `Grep` - cursor-hooks default-allows |
| Glob | `Glob` - cursor-hooks default-allows (not an explicit null mapping, falls through the default case) |
| WebFetch | `WebFetch` |
| WebSearch | `WebSearch` |

**Response format:**
```json
{
  "permission": "allow" | "deny",
  "user_message": "Optional message shown to user",
  "agent_message": "Optional message injected into agent context",
  "updated_input": "Optional modified tool input"
}
```

### cursor-hooks routing

The `preToolUse` handler routes by `tool_name`:

- `"Read"` → FileRead governance (PII scanning, guardrails on file content)
- `"Write"` / `"Edit"` → FileEdit governance (behavioral rules for file_write)
- `"Bash"` / `"Shell"` → Shell governance (fallback if `beforeShellExecution` doesn't fire)
- Other → allow (observe via `postToolUse`)

## Installation

```bash
git clone https://github.com/OpenBox-AI/openbox-sdk.git ~/workspace/cursor-hooks
cd ~/workspace/cursor-hooks && npm install && npm run build
npx tsx scripts/install.ts
```

The install script creates:
- `~/.cursor/hooks.json` - registers all hooks
- `~/.cursor-hooks/` - deployed handler + config
- `~/.cursor-hooks/config.json` - `OPENBOX_API_KEY`, endpoint, policy settings

## Configuration

### Cursor hook timeout (`~/.cursor/hooks.json`)

Each hook entry has an optional `timeout` field (seconds). Cursor's default is **60s** - far too short for HITL approval. The install script sets blocking hooks to **86400s (24h)**.

- Must be a positive number (`<= 0` rejected by Cursor)
- Values `> 3600` trigger a console warning but work fine
- No infinity support - use 86400 for effectively unlimited
- Non-blocking hooks (after*, stop, postToolUse) don't need a timeout

### cursor-hooks config (`~/.cursor-hooks/config.json`)

```json
{
  "OPENBOX_API_KEY": "obx_live_...",
  "OPENBOX_ENDPOINT": "https://core.openbox.ai",
  "GOVERNANCE_POLICY": "fail_open",
  "VERBOSE": true,
  "DRY_RUN": false,
  "HITL_MAX_WAIT": 270
}
```

- `GOVERNANCE_POLICY`: `fail_open` (allow on Core errors) or `fail_closed` (block on Core errors)
- `HITL_MAX_WAIT`: seconds the hook handler polls Core for approval (separate from Cursor's hook timeout)
- `VERBOSE`: log all hook events to stderr (visible in Cursor Output > Hooks)
- `DRY_RUN`: log but don't enforce - all hooks return allow

## Debugging

Check Cursor's Hooks output channel: View → Output → select "Hooks" from dropdown.

Hook logs also write to `~/.cursor-hooks/hook.log`.

Test a hook manually:
```bash
echo '{"hook_event_name":"preToolUse","conversation_id":"test","tool_name":"Read","tool_input":{"file_path":"/tmp/test.txt"}}' | node ~/.cursor-hooks/hook-handler.js
```
