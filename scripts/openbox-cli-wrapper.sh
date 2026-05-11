#!/usr/bin/env sh
# OpenBox CLI wrapper. Installed at ~/.openbox/bin/openbox by
# scripts/install. Resolves the dist-bundle path at every invocation
# instead of via a static symlink, so renaming the source tree
# doesn't silently break the CLI (and every downstream integration —
# Cursor hooks.json, MCP server entries, claude-code hooks, etc. —
# that invokes `openbox` from PATH).
#
# Resolution chain (first match wins):
#   1. $OPENBOX_INSTALL_DIR     env override; per-invocation
#   2. ~/.openbox/install-path  file override; user-set, persistent
#   3. ~/.openbox/src           installer's vendored copy; default
#
# On miss, prints the full chain + three remediation paths and
# exits 127 (POSIX "command not found").

set -e

resolve_dir() {
  if [ -n "${OPENBOX_INSTALL_DIR:-}" ]; then
    printf '%s\n' "$OPENBOX_INSTALL_DIR"
    return
  fi
  if [ -r "$HOME/.openbox/install-path" ]; then
    head -n 1 "$HOME/.openbox/install-path"
    return
  fi
  printf '%s\n' "$HOME/.openbox/src"
}

DIR="$(resolve_dir)"
ENTRY="$DIR/dist/cli/index.js"

if [ ! -f "$ENTRY" ]; then
  printf 'openbox: cannot find CLI bundle at %s\n' "$ENTRY" >&2
  printf '\nResolution chain (first match wins):\n' >&2
  printf '  1. OPENBOX_INSTALL_DIR  (currently: %s)\n' "${OPENBOX_INSTALL_DIR:-<unset>}" >&2
  printf '  2. ~/.openbox/install-path  (currently: ' >&2
  if [ -r "$HOME/.openbox/install-path" ]; then
    head -n 1 "$HOME/.openbox/install-path" >&2
  else
    printf '<unset>)\n' >&2
  fi
  printf '  3. ~/.openbox/src  (default)\n' >&2
  printf '\nFix one of:\n' >&2
  printf '  - export OPENBOX_INSTALL_DIR=/path/to/openbox-sdk\n' >&2
  printf '  - echo /path/to/openbox-sdk > ~/.openbox/install-path\n' >&2
  printf '  - re-run the installer to populate ~/.openbox/src\n' >&2
  exit 127
fi

exec node "$ENTRY" "$@"
