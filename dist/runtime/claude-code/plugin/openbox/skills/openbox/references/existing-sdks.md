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

Use `@openbox-ai/openbox-sdk` as the API-first reference SDK.

| Import | Purpose |
|---|---|
| `@openbox-ai/openbox-sdk/client` | Backend management client |
| `@openbox-ai/openbox-sdk/core-client` | Core governance client and sessions |
| `@openbox-ai/openbox-sdk/copilotkit` | CopilotKit runtime adapter |
| `@openbox-ai/openbox-sdk/copilotkit/react` | CopilotKit React hooks/renderers |
| `@openbox-ai/openbox-sdk/runtime/mcp` | MCP runtime |
| `@openbox-ai/openbox-sdk/runtime/cursor` | Cursor runtime |
| `@openbox-ai/openbox-sdk/runtime/claude-code` | Claude Code runtime |

## Custom Agent Runtime

Use Core sessions:

```ts
import { OpenBoxCoreClient, govern, presets } from '@openbox-ai/openbox-sdk/core-client';

const core = new OpenBoxCoreClient({
  apiUrl: process.env.OPENBOX_CORE_URL,
  apiKey: process.env.OPENBOX_API_KEY,
});

await govern({ core, preset: presets.custom }, async (session) => {
  await session.activity('ActivityStarted', 'ToolCall', { input: { name: 'tool' } });
});
```

## Other Language SDKs

Do not present Python, Rust, Go, Autogen, or Haystack integrations as
released OpenBox packages from this mainline repo. For those stacks,
state that the TypeScript SDK is the current reference implementation
and use the Backend/Core API payloads or a small custom client until a
language package has its own release, generator, tests, and docs.
