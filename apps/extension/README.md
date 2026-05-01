# OpenBox Extension

VS Code and Cursor extension for reviewing and acting on OpenBox
approval requests. Reads its API key from the same `~/.openbox/tokens`
file the `openbox` CLI writes; no separate login flow.

## Install

```bash
# 1. install the CLI if you haven't
curl -fsSL https://raw.githubusercontent.com/OpenBox-AI/openbox-sdk/main/scripts/install | sh

# 2. paste an org X-API-Key from the dashboard's Organization → API Keys
openbox auth set-api-key

# 3. install the extension (auto-detects code + cursor on PATH; --code / --cursor narrows)
openbox install extension
```

Restart VS Code or Cursor after install.

## Build from source

```bash
cd apps/extension
npm install
npm run package    # produces apps/extension/openbox-*.vsix
code --install-extension openbox-*.vsix
# or: cursor --install-extension openbox-*.vsix
```

`npm install` resolves `openbox-sdk` against the workspace at the repo
root, and esbuild bundles it into `dist/extension.js` so the `.vsix`
is self-contained.

## Auth

X-API-Key only. JWT is the mobile-app path; the extension shares the
CLI's token store. On activation, the extension reads
`<env>.API_KEY=…` from `~/.openbox/tokens`; if missing it surfaces an
error message pointing at `openbox auth set-api-key`.

The backend's WS gateway requires JWT auth, so the extension is
polling-only at a 5-second cadence; the realtime path stays out of
the import graph.

## Switch environment

The extension reads `openbox.environment` from VS Code settings.
Default is `production`; choices are `production`, `staging`, `local`.
Two ways to change:

- Settings UI: cmd-, then search for `openbox.environment`.
- Run `OpenBox: Switch Environment` from the command palette.

Status bar shows the active env, e.g. `OpenBox · staging`. Each env
has its own slot in `~/.openbox/tokens` (`<env>.API_KEY=…`); populate
each one separately via `openbox --env <name> auth set-api-key`.

## Features

- Sidebar with pending approvals from the activity bar icon.
- Status bar showing pending count and active environment.
- Env-tagged notification toasts with Approve, Reject, and View
  buttons.
- Tooltip with tier, verdict, reason, and expiry countdown.
- 5s polling.
- QuickPick env switcher: `OpenBox: Switch Environment`.

## Tests

`npm test` runs vitest. The suite mocks the file system and `fetch`,
then verifies the adapter wires the right env URL, X-API-Key header,
and `X-Openbox-Client` header, including the `OPENBOX_CLIENT_VARIANT`
suffix when set.
