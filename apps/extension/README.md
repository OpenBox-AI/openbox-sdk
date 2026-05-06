# OpenBox AI Governance

Active governance for AI coding agents inside VS Code and Cursor.
Every shell exec, file write, AI-driven insert, and file-op passes
through the editor on its way to disk; OpenBox evaluates each one
against the policies you've configured and either lets it through,
asks the human, or stops it.

## What it does

- **PreWriteGate** — `onWillSaveTextDocument` calls
  `check_governance(file_write)` for the configured agent. `allow`
  saves; `require_approval` blocks with a modal until decided;
  `deny` reverts the dirty buffer to disk content (saves succeed but
  bytes don't change).
- **PreFileOpGate** — `onWillCreateFiles` / `onWillDeleteFiles` /
  `onWillRenameFiles`. Catches Composer multi-file edits and AI file
  ops that bypass the agent's Write tool.
- **TabObserver** — classifies non-keystroke buffer changes (Tab
  accept, Cmd-K, Composer inserts) and, when active, evaluates them
  via `check_governance` and reverts denied inserts. Optionally
  emits cursor/agent-trace v0.1.0 records to
  `~/.openbox/log/agent-trace.jsonl` so any tool that ingests the
  open Agent Trace format picks up authorship attribution.
- **Approvals panel** — side panel in the activity bar shows
  pending HITL approvals; approve / reject inline, see the verdict,
  reason, agent, and expiry per row.
- **Status bar** — `OpenBox · <env>` tag with auth state, fall-back
  notice if it auto-switched env, and gate-idle suffix when gates
  are wired but no agent is bound.
- **Hook log channel** — `View → Output → OpenBox Hooks` tails
  `~/.openbox/log/cursor-hook.jsonl` so you can see every hook
  invocation Cursor makes against the OpenBox CLI.

## Install

The extension is part of the unified Cursor / Claude Code install:

```sh
# 1. install the CLI
curl -fsSL https://raw.githubusercontent.com/OpenBox-AI/openbox-sdk/main/scripts/install | sh

# 2. mint or paste an org X-API-Key (Organization → API Keys in the dashboard)
openbox auth set-api-key

# 3. install the full Cursor stack — hooks, MCP, slash commands, rules, agent, skill, extension, hardening
openbox install cursor
```

Restart Cursor (or VS Code) after install.

To install only the extension and skip hooks / MCP / slash commands:

```sh
openbox install extension          # auto-detects `code` + `cursor` on PATH
openbox install extension --cursor # or narrow to one editor
```

## Configuration

Settings (`~/.cursor/User/settings.json` or `cmd-,`):

| Key | Default | Effect |
|---|---|---|
| `openbox.environment` | `production` | Which OpenBox env to talk to (`production` / `staging` / `local`). Each has its own token slot in `~/.openbox/tokens`. |
| `openbox.agentId` | `""` | Agent the gates evaluate against. Without this, all active gates no-op. |
| `openbox.preWriteGate.active` | `false` | Save → `check_governance(file_write)`. Deny reverts buffer to disk. |
| `openbox.fileOpGate.enabled` | `false` | Create/delete/rename → `check_governance`. Cancel on deny. |
| `openbox.tabObserver.active` | `false` | Non-keystroke insert → `check_governance(file_write)`. Revert on deny. Pair with `tabObserver.enabled`. |
| `openbox.tabObserver.emitAgentTrace` | `false` | Append cursor/agent-trace records to `~/.openbox/log/agent-trace.jsonl` for every classified non-keystroke insert. |
| `openbox.failClosed` | `false` | Gates fail closed (cancel) on network error. Default fail open. |
| `openbox.mockAuth` | `false` | Run against built-in fixtures, no API key, no backend — useful for first-run demos. |

## Auth

X-API-Key only. JWT is the mobile-app path; the extension reads the
same token store the CLI writes (`~/.openbox/tokens`, key
`<env>.API_KEY=obx_key_<48 hex>`). On activation:

1. Reads `openbox.environment` (default `production`).
2. Loads the matching `<env>.API_KEY` from the token store.
3. If the requested env has no key, falls back to whichever env
   does (and surfaces "fell back from `<env>`" in the status bar
   tooltip).
4. If no env has a key, fires the first-run prompt — Mock Auth /
   Mint API Key / Open Settings / Don't show again.

## Build from source

```sh
cd apps/extension
npm install
npm run build       # esbuild → dist/extension.js
npm run package     # vsce → openbox-*.vsix
cursor --install-extension openbox-0.1.0.vsix
# or: code --install-extension openbox-0.1.0.vsix
```

## Tests

```sh
npm test                              # vitest unit tests
npm run test:e2e-extension            # wdio against VS Code
OPENBOX_E2E_LIVE=1 OPENBOX_E2E_AGENT_ID=… OPENBOX_E2E_RUNTIME_KEY=… \
  npm run test:e2e-extension          # live-gate suite against a real backend
```

Live e2e drives the gates against a real backend with planted
behavior rules; the unit suite mocks vscode + fetch and pins the
verdict mapping (numeric + string), the revertToDisk path, and the
TabObserver classifier.
