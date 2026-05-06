# Extension e2e (wdio-vscode-service)

Drives a real VS Code (or Cursor) with the freshly-built OpenBox extension installed and runs UI assertions against the live workbench. Layer 3 of the test pyramid:

```
unit              ← apps/extension/src/*.test.ts (mocked vscode)
hook-integration  ← tests/hook-integration/      (subprocess of openbox cursor hook)
e2e-extension     ← this dir                     (wdio-vscode-service)
```

## Running

```bash
# Build the extension first so the .vsix exists.
cd apps/extension && npm run package
cd -

npm run test:e2e-extension
```

## Pointing at Cursor instead of VS Code

By default the harness downloads stable VS Code. To exercise Cursor's
fork:

```bash
OPENBOX_E2E_VSCODE_BINARY="/Applications/Cursor.app/Contents/MacOS/Cursor" \
  npm run test:e2e-extension
```

Cursor is a VS Code fork so the workbench page objects work; the
hook-system surfaces (`~/.cursor/hooks.json`) only fire when Cursor's
agent runs, which is out of scope for these UI tests — see
`tests/hook-integration/` for that layer.

## Headless / CI

```bash
OPENBOX_E2E_HEADLESS=1 xvfb-run -a npm run test:e2e-extension
```

The flag passes `--no-sandbox` to the launched VS Code; `xvfb-run`
provides the X display.

## Suites

- `panel.e2e.ts` — extension activates, status bar paints with the
  `MOCK · staging` tag, OpenBox view container is in the activity bar,
  Pending Approvals lists the 6 mock-auth fixture rows.
- `save-gate.e2e.ts` — Active PreWriteGate behaviors when
  `openbox.agentId` is empty vs set. (See TODO inside; the harness
  doesn't yet flip arbitrary settings reliably.)

Add new suites under `suites/` matching `*.e2e.ts`.

## Why mock auth by default

The wdio config sets `openbox.mockAuth: true` and
`openbox.environment: staging` in the per-run user settings, so the
extension boots without needing a real X-API-Key. The fixture-driven
panel and the navigation-only tests don't need a backend at all. Tests
that need real governance (active gates against a real agent) should
flip mockAuth off in their suite preamble and set
`OPENBOX_API_KEY` + `openbox.agentId` to a runtime key + agent ID
they own.
