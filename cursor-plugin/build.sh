#!/usr/bin/env bash
# Populate cursor-plugin/{skills,commands,hooks,mcp.json} from the
# canonical sources (skill/, cursor-commands/, the spec-emitted hook
# command, the runtime MCP entry). Run before publishing to the
# Cursor Marketplace.
#
# All outputs are .gitignored so this dir holds *only* the manifest
# under .cursor-plugin/ in source control. The bundle is materialized
# at build/publish time.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"

for d in skill cursor-commands cursor-rules cursor-agents; do
  if [[ ! -d "$root/$d" ]]; then
    echo "missing source dir $d/ - run from openbox-sdk worktree" >&2
    exit 1
  fi
done

# 1. skill mirror - Cursor expects skills under <plugin>/skills/<name>/SKILL.md
rm -rf "$here/skills"
mkdir -p "$here/skills/openbox"
cp -R "$root/skill/." "$here/skills/openbox/"

# 2. slash commands
rm -rf "$here/commands"
mkdir -p "$here/commands"
cp "$root/cursor-commands/"*.md "$here/commands/"

# 2b. project rules (.mdc)
rm -rf "$here/rules"
mkdir -p "$here/rules"
cp "$root/cursor-rules/"*.mdc "$here/rules/"

# 2c. plugin agents
rm -rf "$here/agents"
mkdir -p "$here/agents"
cp "$root/cursor-agents/"*.md "$here/agents/"

# 3. hooks - dogfood the CLI: run `install cursor` against a throwaway
#    HOME and copy the resulting hooks.json out. That's the same spec
#    the runtime uses, with the matcher / timeout / shape exactly as
#    Cursor will see it.
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

# 4. mcp.json - point at the published openbox CLI's stdio MCP server
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
