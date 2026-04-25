#!/usr/bin/env bash
# Pre-publish safety check.
#
# Scans the artifacts that get into the published tarball and refuses to
# publish if forbidden patterns appear. Prevents accidental leaks of:
#   - Internal hostnames not meant for end-users
#   - Personal GitHub usernames
#   - AWS account IDs / cluster-internal DNS / secret-store key names
#   - Internal-only S3 bucket names
#
# Wired into each package via `prepublishOnly` so `npm publish` cannot
# succeed if any forbidden pattern slips in. Also safe to run manually:
#   bash scripts/check-publish-safety.sh
#
# Add a new pattern here when you spot a new class of leak. Keep the
# regexes specific to avoid false positives in legitimate code (e.g.,
# "node.lat" matches the staging hostname family without colliding with
# prose containing "node" and "lat" separately).

set -euo pipefail

ROOT="${1:-$(pwd)}"

# Patterns must never appear in published artifacts. Each is an ERE.
FORBIDDEN_PATTERNS=(
  'node\.lat'
  'salamisandwich77'
  '345594574230'
  '416433190225'
  '\.svc\.cluster\.local'
  'staging/openbox-'
  'opa-policies-krnl'
  'age\.openbox\.ai'
)

# Paths inside the package that get published (matches typical "files" allowlist).
SCAN_PATHS=(
  "dist"
  "package.json"
  "README.md"
  "LICENSE"
)

EXIT=0

for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
  for path in "${SCAN_PATHS[@]}"; do
    full="$ROOT/$path"
    if [ -e "$full" ]; then
      hits=$(grep -rnE "$pattern" "$full" 2>/dev/null || true)
      if [ -n "$hits" ]; then
        echo "BLOCKED: pattern '$pattern' found in $path:"
        echo "$hits" | head -20
        echo ""
        EXIT=1
      fi
    fi
  done
done

if [ "$EXIT" -ne 0 ]; then
  echo "Pre-publish safety check failed. Remove the patterns above before publishing."
  echo "Pattern list lives in scripts/check-publish-safety.sh."
  exit "$EXIT"
fi

echo "Pre-publish safety check: OK."
