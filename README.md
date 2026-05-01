# openbox-sdk

Spec-driven, multi-language SDK monorepo for the [OpenBox AI governance
platform](https://openbox.ai). TypeSpec at `specs/typespec/` is the
single source of truth; per-language emitters under `codegen/emitters/`
turn it into native source. TypeScript is the reference implementation
shipped today. Rust is in flight as a wire client. Go and Python
emitters are planned.

## Layout

```
specs/typespec/   source of truth, .tsp
codegen/          TypeSpec decorator libs and per-language emitters
ts/               TypeScript SDK, CLI, runtime adapters
rust/             Rust crate
apps/extension/   VS Code extension on the TS SDK
skill/            Claude and Cursor skill content
tests/            Vitest unit and e2e for the TS surface
```

The TS surface publishes one npm package, `openbox-sdk`. The sub-paths
under **Public sub-paths** cover every consumer-visible surface in that
package. Other-language packages live under their own top-level
directory with their native build and read the same emitted spec.

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
openbox install <target>                  # install one of the supported clients:
#   approver      macOS menu-bar Tauri app
#   extension     VS Code / Cursor extension
#   cursor        Cursor hook integration
#   claude-code   Claude Code hook integration
#   mcp           MCP server entry for Claude Desktop / Cursor / Claude Code
#   skill         SKILL.md content for Claude Code / Cursor
#   mobile        iOS App Store link (placeholder)
openbox uninstall <target>                # mirror of install
openbox doctor                            # verify auth + reachability
openbox --experimental agent list         # the API surface (experimental until validated)
```

Mint an X-API-Key in the dashboard under **Organization → API Keys**,
paste it via `openbox auth set-api-key`, then `openbox install <target>`
for whichever client you're wiring up. The desktop clients (approver,
extension) and the integrations (cursor, claude-code, mcp) all read
the X-API-Key from `~/.openbox/tokens` that the CLI writes — they
require the CLI installed first. Mobile is the only client that uses
its own JWT login flow.

## Public sub-paths

| Import | Purpose |
|---|---|
| `openbox-sdk` | Root facade. Re-exports client, core-client, env, types |
| `openbox-sdk/client` | `OpenBoxClient`, the backend management API |
| `openbox-sdk/core-client` | `OpenBoxCoreClient`, `govern()`, presets, redaction helpers |
| `openbox-sdk/env` | `ENVIRONMENTS`, token store, client-name resolver |
| `openbox-sdk/os-paths` | Node-only path resolver, kept off `/env` for React Native |
| `openbox-sdk/types` | DTOs and the auto-generated `Backend` and `Core` namespaces |
| `openbox-sdk/cli` | Programmatic CLI surface, also reachable as `bin: openbox` |
| `openbox-sdk/runtime/claude-code` | Claude Code hook adapter |
| `openbox-sdk/runtime/cursor` | Cursor hook adapter |
| `openbox-sdk/runtime/mcp` | MCP server runtime |

## License

[MIT](./LICENSE).
