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

## Running against a non-local dev stack

Inject URLs and credentials through your shell or secret manager. The
harness respects the injected values and does not require a committed
endpoint profile:

```bash
INFISICAL_PROJECT_ID="<project-id>" \
infisical run --env=dev --projectId "$INFISICAL_PROJECT_ID" -- \
  npm run test:e2e-extension
```

If `OPENBOX_E2E_AGENT_ID` and `OPENBOX_E2E_RUNTIME_KEY` are not
present, the harness uses `OPENBOX_BACKEND_API_KEY` to create a
disposable test agent and deletes it at the end of the run.

`infisical run --env=dev` selects only the Infisical secret environment.
The SDK target is URL-first: inject `OPENBOX_API_URL` and
`OPENBOX_CORE_URL` for the stack under test.

## Pointing at Cursor instead of VS Code

By default the harness downloads stable VS Code. To exercise Cursor's
fork:

```bash
OPENBOX_E2E_VSCODE_BINARY="/Applications/Cursor.app/Contents/MacOS/Cursor" \
  npm run test:e2e-extension
```

Cursor is a VS Code fork so the workbench page objects work; the
hook-system surfaces (`~/.cursor/hooks.json`) only fire when Cursor's
agent runs, which is out of scope for these UI tests; see
`tests/hook-integration/` for that layer.

## Headless / CI

```bash
OPENBOX_E2E_HEADLESS=1 xvfb-run -a npm run test:e2e-extension
```

The flag passes `--no-sandbox` to the launched VS Code; `xvfb-run`
provides the X display.

## Suites

The harness runs `suites/live-e2e.e2e.ts` only. It boots with
`openbox.mockAuth: false`, validates the selected runtime key against
core, exercises live governance verdicts, and checks the active editor
gates in a real workbench.

Add new suites under `suites/` matching `*.e2e.ts` only when they need a
real workbench. Anything that can run against mocked `vscode` belongs in
`apps/extension/src/*.test.ts`.
