# OpenBox Extension

VS Code / Cursor extension for reviewing and acting on OpenBox approval requests.

## Install

```bash
git clone https://github.com/OpenBox-AI/openbox-extension.git ~/.cursor/extensions/openbox-extension
cd ~/.cursor/extensions/openbox-extension
npm install && npm run build
```

Restart Cursor after install.

`npm install` pulls `openbox-sdk` directly from
`github:OpenBox-AI/openbox-sdk` (npm clones, runs `prepare` to build
the SDK, drops `dist/` into `node_modules`). No sibling-checkout
assumption, no folder layout requirements. esbuild bundles the SDK into
`dist/extension.js`, so the .vsix is self-contained.

## Requirements

- `~/.openbox/tokens` (from `openbox auth login` or `openbox auth set-token`)
- Network access to clone `OpenBox-AI/openbox-sdk` (private repo - gh auth)

## Switch environment

The extension reads `openbox.environment` from VS Code settings (default
`production`; choices: `production`, `staging`, `local`). Two ways to change:

- Open settings (cmd-,) and search for `openbox.environment`
- Run the command `OpenBox: Switch Environment` from the command palette

The status bar shows the active env (`OpenBox · staging`). Tokens are
read from `~/.openbox/tokens` per env, so logging in via the CLI to a
specific env (`openbox --env staging auth login`) automatically makes
that env's credentials available to the extension.

## Features

- Sidebar with pending approvals (activity bar icon)
- Status bar showing pending count + active environment
- Notification toasts with Approve / Reject / View buttons (env-tagged)
- Tooltip with tier, verdict, reason, expiry countdown
- 5s polling
- QuickPick env switcher (`OpenBox: Switch Environment`)

## Tests

`npm test` (vitest). Mocks the file system + fetch and verifies the
adapter wires the right env URL, JWT, and `X-Openbox-Client` header
(including the `OPENBOX_CLIENT_VARIANT` suffix when set).
