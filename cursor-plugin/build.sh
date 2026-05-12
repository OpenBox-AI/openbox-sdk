#!/usr/bin/env bash
# Build the cursor-plugin distribution bundle.
#
# Cursor's plugin runtime expects assets at fixed paths inside the
# plugin root: `skills/`, `commands/`, `rules/`, `agents/`,
# `hooks/hooks.json`, and `mcp.json`. This script materializes those
# from the tracked sources:
#
#   cursor-plugin/src/{agents,commands,rules}/  (tracked)
#   skill/                                       (tracked; shared with claude)
#   INSTALL_SPEC                                 (spec-emitted)
#   runtime/mcp                                  (SDK)
#
# All output paths under `cursor-plugin/` are gitignored, so the
# repo only carries the manifest at `.cursor-plugin/` and the
# tracked sources at `src/`. Run before publishing to the Cursor
# Marketplace.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"
src="$here/src"

for d in "$root/skill" "$src/commands" "$src/rules" "$src/agents"; do
  if [[ ! -d "$d" ]]; then
    echo "missing source dir $d - run from openbox-sdk worktree" >&2
    exit 1
  fi
done

# 1. skill mirror. Cursor expects skills under
#    `<plugin>/skills/<name>/SKILL.md`. The `skill/` source lives at
#    the repo root because it is also consumed by Claude Code.
rm -rf "$here/skills"
mkdir -p "$here/skills/openbox"
cp -R "$root/skill/." "$here/skills/openbox/"

# 2. slash commands.
rm -rf "$here/commands"
mkdir -p "$here/commands"
cp "$src/commands/"*.md "$here/commands/"

# 2b. project rules (`.mdc`).
rm -rf "$here/rules"
mkdir -p "$here/rules"
cp "$src/rules/"*.mdc "$here/rules/"

# 2c. plugin agents.
rm -rf "$here/agents"
mkdir -p "$here/agents"
cp "$src/agents/"*.md "$here/agents/"

# 3. hooks. Dogfood the CLI: run `install cursor` against a
#    throwaway HOME and copy the resulting hooks.json out. That
#    uses the same spec the runtime consumes, with the matcher,
#    timeout, and shape exactly as Cursor will see it.
rm -rf "$here/hooks"
mkdir -p "$here/hooks"
hooks_tmp="$(mktemp -d)"
trap 'rm -rf "$hooks_tmp"' EXIT
HOME="$hooks_tmp" OPENBOX_SKIP_EXTENSION=1 \
  node "$root/dist/cli/index.js" install cursor --no-harden >/dev/null 2>&1 || {
  echo "openbox CLI not built. Run (cd $root && npm run build:bundle) first." >&2
  exit 1
}
cp "$hooks_tmp/.cursor/hooks.json" "$here/hooks/hooks.json"

# 4. mcp.json. Points at the published openbox CLI's stdio MCP
#    server.
cat >"$here/mcp.json" <<'JSON'
{
  "mcpServers": {
    "openbox": {
      "command": "openbox",
      "args": ["mcp", "serve"]
    }
  }
}
JSON

echo "Bundled cursor-plugin/ at $here"
echo "  skills/openbox    ($(ls "$here/skills/openbox" | wc -l | tr -d ' ') entries)"
echo "  commands/         ($(ls "$here/commands" | wc -l | tr -d ' ') files)"
echo "  rules/            ($(ls "$here/rules" | wc -l | tr -d ' ') files)"
echo "  agents/           ($(ls "$here/agents" | wc -l | tr -d ' ') files)"
echo "  hooks/hooks.json"
echo "  mcp.json"
echo ""
echo "Next: publish via Cursor Marketplace (see Cursor docs)."
