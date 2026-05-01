# OpenBox Extension

VS Code and Cursor extension for reviewing and acting on OpenBox
approval requests.

## Install

The extension lives in this monorepo at `apps/extension/`. Build and
install from a checkout:

```bash
git clone https://github.com/OpenBox-AI/openbox-sdk.git
cd openbox-sdk/apps/extension
npm install
npm run package    # produces openbox-extension-*.vsix
code --install-extension openbox-extension-*.vsix
# or: cursor --install-extension openbox-extension-*.vsix
```

`npm install` resolves `openbox-sdk` against the workspace at the repo
root, and esbuild bundles it into `dist/extension.js` so the `.vsix`
is self-contained.

Restart VS Code or Cursor after install.

## Auth

The extension reads a Bearer JWT from `~/.openbox/tokens`. Tokens are
per-env, namespaced as `<env>.ACCESS_TOKEN=...`. The realtime
WebSocket path reuses the same token for `Sec-WebSocket-Protocol`
auth.

The `openbox` CLI is X-API-Key-only as of v0.2.0 and does not populate
that file. Until the extension grows X-API-Key support, the user must
populate `~/.openbox/tokens` manually from the dashboard.

## Switch environment

The extension reads `openbox.environment` from VS Code settings.
Default is `production`; choices are `production`, `staging`, `local`.
Two ways to change:

- Settings UI: cmd-, then search for `openbox.environment`.
- Run `OpenBox: Switch Environment` from the command palette.

The status bar shows the active env, e.g. `OpenBox · staging`. Tokens
are read from `~/.openbox/tokens` per env, so populating an
env-specific entry makes that env's credential available to the
extension.

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
then verifies the adapter wires the right env URL, JWT, and
`X-Openbox-Client` header, including the `OPENBOX_CLIENT_VARIANT`
suffix when set.
