# OpenBox CLI Reference

The `openbox` binary is intentionally small. It installs host
integrations, runs local runtime entrypoints, checks health, stores
configuration, and calls generated Backend/Core API operations by
operation id.

## Stable Command Groups

| Command | Purpose |
|---|---|
| `openbox auth` | Store, clear, and inspect backend X-API-Key state |
| `openbox connect` | Configure a stack URL and backend key |
| `openbox config` | Read/write shared local OpenBox config |
| `openbox api` | Spec-driven Backend/Core operation caller |
| `openbox health` | Lightweight service reachability |
| `openbox doctor` | Local install/runtime diagnosis |
| `openbox versions` | Print SDK/runtime version information |
| `openbox install` | Project-local host install |
| `openbox uninstall` | Remove project-local host install |
| `openbox cursor` | Cursor plugin export/doctor/hook runtime |
| `openbox claude-code` | Claude Code plugin export/doctor/hook runtime |
| `openbox mcp` | MCP stdio server runtime |

## Spec-Driven API Caller

List operations:

```sh
openbox api list backend
openbox api list core
```

Call a backend operation:

```sh
openbox api backend <operationId> --body '{"key":"value"}'
```

Call a Core operation:

```sh
openbox api core <operationId> --body '{"key":"value"}'
```

Use `--body @payload.json` for file input and `--body -` for stdin.

## Project-Local Installs

```sh
openbox install cursor --cwd <project>
openbox install claude-code --cwd <project>
openbox uninstall cursor --cwd <project>
openbox uninstall claude-code --cwd <project>
```

Cursor installs a local plugin at:

```text
<project>/.cursor/plugins/local/openbox
```

Claude Code installs project-local OpenBox assets under the target
project. The install flow should not write global host config unless a
future command explicitly says so.

## Runtime Entrypoints

These are called by plugins/hosts, not usually by humans:

```sh
openbox cursor hook
openbox claude-code hook
openbox mcp serve
```

## Credential Split

Core/runtime governance:

```sh
OPENBOX_CORE_URL=http://localhost:8086
OPENBOX_API_KEY=obx_test_...
```

Backend/API management:

```sh
OPENBOX_API_URL=http://localhost:3000
OPENBOX_BACKEND_API_KEY=obx_key_...
```

Do not use agent attestation tokens as `OPENBOX_API_KEY`. Runtime keys
must use the OpenBox runtime-key format expected by Core.
