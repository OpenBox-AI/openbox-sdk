# OpenBox · Cursor plugin bundle

This directory is the [Cursor plugin](https://docs.cursor.com/plugins)
manifest for OpenBox. It holds `.cursor-plugin/plugin.json` so the
bundle is discoverable as a Marketplace plugin.

The runtime contents (`skills/`, `commands/`, `rules/`, `agents/`,
`hooks/`, `mcp.json`) are materialized at publish time from the
canonical sources: the shared `skill/` directory at the repo root
plus this plugin's own `src/{agents,commands,rules}/`, with
`hooks.json` produced from the cursor adapter's spec-emitted
`INSTALL_SPEC`. Every output directory is `.gitignore`d to keep one
source of truth.

## Build the bundle

```sh
(cd ../.. && npm run build)   # so build.sh can read INSTALL_SPEC
./build.sh
```

After `build.sh`, the directory holds everything Cursor expects.

## What ships

- **skills/openbox** — the OpenBox skill (mirror of `../../skill/`).
- **commands/openbox-*.md** — slash commands the user can run in
  Cursor chat (`/openbox-doctor`, `/openbox-status`,
  `/openbox-pending`, `/openbox-list-agents`, `/openbox-check`).
- **rules/openbox.mdc** — `alwaysApply` project rule that surfaces
  the active governance state (environment, agent binding, gates,
  approvals) to every chat.
- **agents/openbox-reviewer.md** — plugin agent template that
  reviews changes against the active behavior rules, guardrails,
  and AIVSS posture using spec-driven CLI calls.
- **hooks/hooks.json** — pre and post hook config emitted from the
  cursor adapter TypeSpec. Every event the CLI installs into
  `~/.cursor/hooks.json` is mirrored here from the single spec
  source.
- **mcp.json** — registers `openbox mcp serve` as an MCP server.

## Tracked vs generated

```
apps/cursor-plugin/
  .cursor-plugin/        tracked  Marketplace manifest
  README.md              tracked  this file
  build.sh               tracked  bundler
  src/                   tracked  agents, commands, rules
  skills/                generated
  commands/              generated
  rules/                 generated
  agents/                generated
  hooks/                 generated
  mcp.json               generated
```

## Local install without Marketplace

For day-to-day development, prefer `openbox install cursor`. That
writes the hook block, the IDE extension, the MCP entry, this
skill, and the slash commands directly into `~/.cursor/`. The
plugin bundle is for publishing to the Marketplace; the CLI install
applies the same content to a per-user `~/.cursor/`.

The CLI install accepts a `--scope` flag so the hook block and MCP
entry can be confined to a single project rather than the user
account. See `openbox cursor install --help`.
