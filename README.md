# openbox-sdk

Spec-driven TypeScript SDK for the [OpenBox AI governance
platform](https://openbox.ai). TypeSpec at `specs/typespec/` is the
single source of truth; the TypeScript emitter under `codegen/emitters/`
turns it into generated SDK source. Other language SDKs belong on their
own branches or package tracks until they have separate release gates.

## Layout

```
specs/typespec/         source of truth (.tsp)
codegen/                TypeSpec decorator libs and TypeScript emitter
ts/                     TypeScript SDK, CLI, runtime adapters
skill/                  shared OpenBox skill content (Claude + Cursor)
tests/                  Vitest unit, e2e, and hook-integration suites
scripts/                build and install helpers
apps/
  extension/            VS Code / Cursor extension
```

The repo publishes one npm package, `openbox-sdk`. The sub-paths under
**Public sub-paths** cover every consumer-visible surface in that
package. Client applications under `apps/` consume the SDK; the SDK
never depends on them.

## Install

### CLI

Build-from-source via curl-pipe (no published package):

```bash
curl -fsSL https://raw.githubusercontent.com/OpenBox-AI/openbox-sdk/main/scripts/install | sh
```

While the repo is private, fetch via `gh` (uses your authenticated
session for both fetch and clone) or a raw token:

```bash
gh api -H "Accept: application/vnd.github.raw" \
  repos/OpenBox-AI/openbox-sdk/contents/scripts/install | sh

# or, for CI / scripted environments:
curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://raw.githubusercontent.com/OpenBox-AI/openbox-sdk/main/scripts/install | sh
```

The installer clones the source, runs `npm ci` (or `bun install` if
present) + `npm run build`, symlinks `~/.openbox/bin/openbox` →
`dist/cli/index.js`, sources `~/.openbox/env` from your shell rc, and
`exec`s a fresh shell so PATH is live in the same terminal. Env
overrides: `OPENBOX_VERSION` (git ref), `OPENBOX_INSTALL_DIR`,
`OPENBOX_LOCAL_SOURCE` (skip clone, use local checkout),
`OPENBOX_NO_PATH`, `OPENBOX_NO_RELOAD`.

### Library

```bash
npm install openbox-sdk@github:OpenBox-AI/openbox-sdk
```

Pin to a tag for reproducibility: `…/openbox-sdk#v0.1.0`.

## Use

### Library

```typescript
import { govern, presets, OpenBoxCoreClient } from 'openbox-sdk/core-client';

const apiKey = process.env.OPENBOX_API_KEY;
if (!apiKey) throw new Error('OPENBOX_API_KEY not set');
const core = new OpenBoxCoreClient({ apiKey });

await govern({ core, preset: presets.claudeCode }, async (session) => {
  const verdict = await session.preToolUse({
    input: [{ tool_name: 'Bash', command: 'rm -rf /' }],
  });
  if (verdict.arm === 'block') throw new Error(verdict.reason);
  // ...your tool body
});
```

`govern()` opens a workflow envelope, fires `WorkflowStarted`, runs the
callback, then fires `WorkflowCompleted` on return or `WorkflowFailed`
on throw. The envelope is finalized on process exit even when the
callback never returns.

Per-event hook binaries that spawn a fresh process per event use
`govern.attach()` instead. Same typed sessions; the workflow boundaries
are not auto-fired because the host process owns them.

### CLI

```bash
openbox auth set-api-key                  # paste an org X-API-Key from the dashboard
openbox install cursor                    # install project-local Cursor plugin
openbox cursor plugin export --out ./openbox-plugin
openbox install claude-code               # install project-local Claude Code plugin
openbox claude-code plugin export --out ./openbox-claude-plugin
openbox mcp serve                         # runtime entrypoint used by plugins/hosts

openbox doctor                            # verify auth + reachability
openbox api list backend                  # list generated Backend operation IDs
openbox api backend AgentController_getAgents
openbox api core validateApiKey
```

Mint an X-API-Key in the dashboard under **Organization → API Keys**,
paste it via `openbox auth set-api-key`, then `openbox install <target>`
for whichever client you're wiring up. The Cursor and Claude Code
plugins own agent capabilities/config (`hooks`, MCP, skills, commands,
rules, agents). The approval UI extension is packaged separately; the
SDK CLI does not perform host-global extension installs.

## Primary public sub-paths

These are the main consumer-facing imports. `package.json` remains the
exhaustive source for every exported support surface.

| Import | Purpose |
|---|---|
| `openbox-sdk` | Root facade. Re-exports client, core-client, env, types |
| `openbox-sdk/client` | `OpenBoxClient`, the backend management API |
| `openbox-sdk/core-client` | `OpenBoxCoreClient`, `govern()`, presets, redaction helpers |
| `openbox-sdk/env` | URL resolution, token store, client-name resolver |
| `openbox-sdk/os-paths` | Node-only path resolver, kept off `/env` for React Native |
| `openbox-sdk/types` | DTOs and the auto-generated `Backend` and `Core` namespaces |
| `openbox-sdk/runtime/claude-code` | Claude Code hook adapter |
| `openbox-sdk/runtime/cursor` | Cursor hook adapter |
| `openbox-sdk/runtime/mcp` | MCP server runtime |
| `openbox-sdk/copilotkit` | CopilotKit runtime adapter, governed tools, approval route |
| `openbox-sdk/copilotkit/react` | CopilotKit React hooks and OpenBox renderers |

## License

[MIT](./LICENSE).
