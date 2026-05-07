# OpenBox

Review and act on OpenBox approval requests directly inside VS Code
and Cursor. When an AI agent in your stack pauses for a human
decision, this extension surfaces it in the editor sidebar so you
can approve or reject without leaving your code.

## Features

- Pending approvals in the activity bar with one-click approve / reject
- History of decided requests (approved, rejected, expired)
- Detail panel with the full request, the matching policy, and
  expiry countdown
- Search, filter, and sort across pending and history
- Status bar item showing the pending count and signed-in user
- Optional save / file-operation / AI-insert protections that ask
  OpenBox before the action reaches your disk

## Install

The fastest path is the OpenBox CLI:

```sh
curl -fsSL https://openbox.ai/install.sh | sh
openbox auth set-api-key
openbox install extension
```

You'll be prompted to paste an API key. Generate one in the
[OpenBox dashboard](https://openbox.ai) under
`Organization > API Keys`.

`openbox install extension` finds VS Code and Cursor automatically
and installs the bundled extension into both.

### Manual install

If you'd rather not use the CLI, grab `openbox-x.y.z.vsix` from the
[Releases page](https://github.com/OpenBox-AI/openbox-sdk/releases)
and install it through your editor's extensions panel
(`Extensions > ... > Install from VSIX`), or via the command line:

```sh
cursor --install-extension openbox-0.1.0.vsix
code   --install-extension openbox-0.1.0.vsix
```

You'll still need to set an API key. Open the command palette
(`Cmd-Shift-P`) and run **OpenBox: Set API Key**, or use the CLI's
`openbox auth set-api-key`.

## Getting started

After install, restart your editor and open the OpenBox icon in
the activity bar. The Welcome panel appears the first time and
walks you through pasting an API key. Once that's done:

- **Pending** lists every request waiting for a decision
- **History** keeps the last decided requests so you can audit
  past calls
- **Profile** shows who you're signed in as and lets you sign out

If you want OpenBox to step in *before* an agent's change touches
your code (file write, file delete, AI completion accept), turn on
the matching toggle in settings:

- **OpenBox: Pre Write Gate Active**
- **OpenBox: File Op Gate Enabled**
- **OpenBox: Tab Observer Active**

These need an Agent ID set (**OpenBox: Agent Id**) so OpenBox knows
which policy to consult.

## Build from source

Contributors only:

```sh
cd apps/extension
npm install
npm run build
npm run package
cursor --install-extension openbox-0.1.0.vsix
```

`npm run build:dev` produces a debug build with extra commands
(switch environment, mock auth, debug info) wired in.

## Tests

```sh
npm test                       # vitest unit tests
```
