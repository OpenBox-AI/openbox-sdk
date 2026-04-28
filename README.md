# openbox-sdk

TypeScript SDK + CLI + LLM-host runtime adapters for the
[OpenBox AI governance platform](https://openbox.ai). Generated from a
TypeSpec source of truth that's shared with the (in-progress) Rust /
Go / Python SDKs in this monorepo.

## What's in here

```
specs/typespec/   ← source of truth (.tsp)
codegen/          ← TypeSpec decorator libs + emitters
ts/src/           ← TypeScript SDK (this repo's primary deliverable)
rust/             ← Rust crate (wire client today; full SDK in progress)
apps/extension/   ← VS Code extension (own toolchain, own publish)
skill/            ← Claude/Cursor "skill" content shipped via `openbox skill install`
tests/            ← unit + e2e (Vitest)
```

The repo is one npm package - `openbox-sdk` - published from the root.
Sub-paths in `package.json`'s `exports` map cover every consumer-visible
surface; bundlers tree-shake whatever you don't import.

## 30-second integration

```bash
npm install openbox-sdk@github:OpenBox-AI/openbox-sdk
```

```typescript
import { govern, presets } from 'openbox-sdk/core-client';
import { OpenBoxCoreClient } from 'openbox-sdk/core-client';

const core = new OpenBoxCoreClient({ apiKey: process.env.OPENBOX_API_KEY! });

await govern({ core, preset: presets.claudeCode }, async (session) => {
  const verdict = await session.preToolUse({
    input: [{ tool_name: 'Bash', command: 'rm -rf /' }],
  });
  if (verdict.arm === 'block') throw new Error(verdict.reason);
  // ...your tool body
});
```

`govern()` opens the workflow envelope, fires `WorkflowStarted`, runs
your body, fires the paired `WorkflowCompleted` (or `WorkflowFailed` on
throw), and finalizes - even if the process dies mid-flight.

For per-event hook binaries (Claude Code / Cursor invoke a fresh process
per event), use `govern.attach()` - same typed sessions, no auto-fire of
the workflow boundaries since the harness owns that.

## Public sub-paths

| Import | Purpose |
|---|---|
| `openbox-sdk` | Root facade: client + core-client + env + types |
| `openbox-sdk/client` | `OpenBoxClient` - backend management API |
| `openbox-sdk/core-client` | `OpenBoxCoreClient` + `govern()` + 22 typed presets + redaction helpers |
| `openbox-sdk/env` | `ENVIRONMENTS`, token store, client-name resolver |
| `openbox-sdk/os-paths` | Node-only path resolver (RN-safe - kept off `/env`) |
| `openbox-sdk/types` | Hand-curated DTOs + auto-generated `Backend` / `Core` namespaces |
| `openbox-sdk/cli` | Programmatic CLI surface (also reachable as `bin: openbox`) |
| `openbox-sdk/runtime/claude-code` | Claude Code hook adapter primitive + platform integration |
| `openbox-sdk/runtime/cursor` | Cursor IDE hook adapter primitive + platform integration |
| `openbox-sdk/runtime/mcp` | MCP server runtime (`runMcpServer()`) |

## CLI

```bash
npm install -g openbox-sdk@github:OpenBox-AI/openbox-sdk
openbox auth login
openbox agent list
openbox claude-code install   # writes ~/.claude/settings.json hooks block
openbox cursor install        # writes ~/.cursor/hooks.json
openbox mcp serve             # MCP stdio server
openbox skill install         # copies SKILL.md into ~/.claude/skills/openbox/
```

The CLI uses a maturity gate: by default `--help` shows only commands
that have been verified end-to-end. Pass `--experimental` (or
`OPENBOX_EXPERIMENTAL_LEVEL=experimental`) to surface the rest. Fine-grained
opt-ins for in-command experimental options use `--feature <name>`.

## How it's built

```bash
npm install              # workspaces (codegen libs + extension)
npm run specs:all        # TypeSpec compile → emitters → openapi-typescript
npm run build            # build:codegen → specs → bundle to dist/
npm test                 # vitest unit + e2e
```

Anything in `ts/src/**/generated/`, `specs/generated/`, or
`apps/*/dist/` is auto-emitted - never hand-edit. The
`check:generated-drift` script runs the full pipeline and asserts
`git diff --exit-code` on those paths; CI does the same on every PR.

## Contributing

See `CONTRIBUTING.md` for the four flow recipes (add-a-preset,
add-an-adapter, add-a-CLI-command, add-an-env-var) and the
spec-vs-hand-coded boundary that the codegen pipeline assumes.

## License

[MIT](./LICENSE).
