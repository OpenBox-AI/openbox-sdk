# OpenBox Integration Paths

Pick the shortest supported path for the user's stack.

## Cursor, Claude Code, MCP Hosts

Use the CLI installer. Installs are project-local.

```sh
openbox install cursor --cwd <project>
openbox install claude-code --cwd <project>
openbox mcp serve
```

Cursor and Claude Code plugins provide host capabilities/config.
The extension/UI surface owns approval panels, history, and pending
decision display.

## TypeScript SDK

Use `openbox-sdk` as the API-first reference SDK.

| Import | Purpose |
|---|---|
| `openbox-sdk/client` | Backend management client |
| `openbox-sdk/core-client` | Core governance client and sessions |
| `openbox-sdk/copilotkit` | CopilotKit runtime adapter |
| `openbox-sdk/copilotkit/react` | CopilotKit React hooks/renderers |
| `openbox-sdk/runtime/mcp` | MCP runtime |
| `openbox-sdk/runtime/cursor` | Cursor runtime |
| `openbox-sdk/runtime/claude-code` | Claude Code runtime |

## Custom Agent Runtime

Use Core sessions:

```ts
import { OpenBoxCoreClient, govern, presets } from 'openbox-sdk/core-client';

const core = new OpenBoxCoreClient({
  apiUrl: process.env.OPENBOX_CORE_URL,
  apiKey: process.env.OPENBOX_API_KEY,
});

await govern({ core, preset: presets.custom }, async (session) => {
  await session.activity('ActivityStarted', 'ToolCall', { input: { name: 'tool' } });
});
```

## Other Language SDKs

Other language SDKs should live on their own branch/package track until
their generator, build, tests, and docs are release-ready. Do not treat
Rust/Python/Go source as part of the TypeScript SDK mainline unless the
branch has been explicitly approved for merge.
