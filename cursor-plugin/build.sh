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

if [[ ! -d "$root/skill" ]] || [[ ! -d "$root/cursor-commands" ]]; then
  echo "missing source dirs (skill/, cursor-commands/) — run from openbox-sdk worktree" >&2
  exit 1
fi

# 1. skill mirror — Cursor expects skills under <plugin>/skills/<name>/SKILL.md
rm -rf "$here/skills"
mkdir -p "$here/skills/openbox"
cp -R "$root/skill/." "$here/skills/openbox/"

# 2. slash commands
rm -rf "$here/commands"
mkdir -p "$here/commands"
cp "$root/cursor-commands/"*.md "$here/commands/"

# 3. hooks — the install spec is generated; we read the same INSTALL_SPEC
#    the runtime uses and emit the marketplace-shaped hooks.json.
rm -rf "$here/hooks"
mkdir -p "$here/hooks"
node --input-type=module -e '
import { INSTALL_SPEC } from "../ts/dist/core-client/generated/runtime/cursor.js";
import { writeFileSync } from "node:fs";
const hooks = {};
for (const evt of INSTALL_SPEC.events) {
  hooks[evt.name] = [{ command: evt.command, ...(evt.matcher ? { matcher: evt.matcher } : {}) }];
}
writeFileSync("'"$here"'/hooks/hooks.json", JSON.stringify({ hooks }, null, 2) + "\n");
' || {
  echo "ts must be built first: (cd $root/ts && npm run build)" >&2
  exit 1
}

# 4. mcp.json — point at the published openbox CLI's stdio MCP server
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
echo "  hooks/hooks.json"
echo "  mcp.json"
echo ""
echo "Next: publish via Cursor Marketplace (see Cursor docs)."
