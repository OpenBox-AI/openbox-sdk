# OpenBox - Cursor plugin bundle

This directory is the [Cursor plugin](https://docs.cursor.com/plugins)
manifest for OpenBox. It holds `.cursor-plugin/plugin.json` so the
bundle is discoverable as a Marketplace plugin.

The runtime contents - `skills/`, `commands/`, `rules/`, `agents/`,
`hooks/`, `mcp.json` - are materialized at publish time from the
canonical sources (`skill/`, `cursor-commands/`, `cursor-rules/`,
`cursor-agents/`, `INSTALL_SPEC` from the cursor adapter spec).
Those output dirs are `.gitignore`d to keep one source of truth.

## Build the bundle

```sh
(cd ../ts && npm run build)   # so build.sh can read INSTALL_SPEC
./build.sh
```

After `build.sh`, the directory holds everything Cursor expects.

## What ships

- **skills/openbox** - the OpenBox skill (mirror of `../skill/`)
- **commands/openbox-*.md** - slash commands the user can run in
  Cursor chat (`/openbox-doctor`, `/openbox-status`,
  `/openbox-pending`, `/openbox-list-agents`, `/openbox-check`)
- **rules/openbox.mdc** - `alwaysApply` project rule that surfaces
  the active governance state (env, agent binding, gates,
  approvals) to every chat
- **agents/openbox-reviewer.md** - plugin agent template that
  reviews changes against the active behavior rules / guardrails
  / AIVSS posture using spec-driven CLI calls
- **hooks/hooks.json** - pre/post hook config emitted from the
  cursor adapter TypeSpec (single source of truth: every event the
  CLI installs into `~/.cursor/hooks.json` is mirrored here)
- **mcp.json** - registers `openbox mcp serve` as an MCP server

## Local install (without Marketplace)

For day-to-day dev, prefer `openbox install cursor`. That writes
hooks, the IDE extension, the MCP entry, this skill, and the slash
commands directly into `~/.cursor/`. The plugin bundle is for
publishing to the Marketplace; the CLI install is the same content
applied to a per-user `~/.cursor/`.
