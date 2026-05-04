# OpenBox Approver

Native macOS tray app for reviewing and acting on OpenBox approval
requests. Reads its API key from the same `~/.openbox/tokens` file the
`openbox` CLI writes; no separate login flow.

## Requirements

- macOS
- The `openbox` CLI installed and logged in via `openbox auth set-api-key`

## Install

```bash
# 1. install the CLI if you haven't
curl -fsSL https://raw.githubusercontent.com/OpenBox-AI/openbox-sdk/main/scripts/install | sh

# 2. paste an org X-API-Key from the dashboard's Organization → API Keys
openbox auth set-api-key

# 3. install the approver into /Applications
openbox install approver
```

`openbox install approver` copies the prebuilt `OpenBox Approver.app`
bundle into `/Applications`. Pass `--dest <path>` for a different
location.

## Build from source

The approver is a member of the openbox-sdk workspace at
`apps/approver`; it builds against the in-tree `openbox-sdk` Rust
crate at `../../rust` so changes to the SDK feed straight into the
tray.

For development (from this directory):

```bash
npm install                            # only @tauri-apps/cli
npm run dev                            # production env (default)
OPENBOX_ENV=staging  npm run dev       # staging
OPENBOX_ENV=local    npm run dev       # local dev stack
```

Bundle for distribution / `openbox install approver`:

```bash
npm run build
# bundle lands at src-tauri/target/release/bundle/macos/OpenBox Approver.app
```

## Auth

X-API-Key only. JWT is the mobile-app path; desktop clients share the
CLI's token store. On startup, `ApiClient::new()` reads
`<env>.API_KEY=…` from `~/.openbox/tokens`; missing it prints the
`openbox auth set-api-key` hint and exits.

`OPENBOX_ENV` (production / staging / local) selects which env's key
to load. Tokens are env-namespaced so signing into staging never
clobbers prod credentials. Unknown `OPENBOX_ENV` values hard-fail.

## Features

- Native NSStatusItem + NSMenu (no Electron / WebKit)
- Polls pending approvals every 5s; menu refresh wakes the loop early
- Approve / reject from the submenu
- Tier, verdict, reason, expiry countdown rendered inline
- macOS notifications on new approvals
- Menu-bar only (no Dock icon)

## Architecture

```
src-tauri/src/
  api.rs          openbox_sdk::OpenBoxClient adapter
  lib.rs          Tauri setup, polling loop, menu wiring
  native_tray.rs  NSStatusItem + NSMenu plumbing
static/
  index.html      empty placeholder; Tauri requires a frontendDist path
                  even though the app declares no windows
```

Every HTTP call goes through `openbox_sdk::OpenBoxClient`'s
spec-emitted typed wrappers (`get_profile`, `list_agents`,
`get_org_approvals`, `decide_approval`). A single-threaded tokio
runtime bridges the sync polling thread to the SDK's async surface.

Activity-type labels, summarized inputs, verdict strings, and
relative-time formatting come from `openbox_sdk::approvals::format`,
the Rust port of `ts/src/approvals/format.ts`. Mobile, the VS Code
extension, and the approver render a given approval the same way; the
canonical activity-label table is spec-emitted into
`rust/src/core/generated/govern.rs`.
