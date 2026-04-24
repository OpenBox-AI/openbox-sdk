#!/usr/bin/env bash
#
# Brings up a local OpenBox backend stack so the CLI's e2e tests (and
# destructive commands in general) can run without touching staging or prod.
#
# What it does:
#   1. Starts postgres + redis + keycloak via the-backend-service/docker-compose.yml
#   2. Waits for Keycloak to be reachable
#   3. Generates a minimal backend .env if one doesn't exist
#   4. Installs backend deps (yarn) if node_modules is missing
#   5. Prints the remaining manual step (Keycloak realm + clients)
#
# What it does NOT do (yet):
#   - Bootstrap the Keycloak `openbox` realm, `the-backend-service` client, or
#     `the-backend-service-fe` client. Those require admin-UI choices we can't
#     auto-pick (client secrets, redirect URIs to match your FE port, etc.).
#     See DEV.md for the manual step.
#   - Run backend migrations - they run automatically when `yarn start:dev`
#     hits the DB.
#
# Requires: Docker Desktop running, yarn, node 23+.
#
# Usage:
#   bash scripts/local-backend-up.sh            # full stand-up
#   bash scripts/local-backend-up.sh --down     # tear everything down

set -euo pipefail

BACKEND_DIR="${BACKEND_DIR:-$HOME/workspace/the-workspace/the-backend-service}"
KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8080}"

color() { printf '\033[%sm%s\033[0m\n' "$1" "$2"; }
ok()   { color "32" "✓ $1"; }
info() { color "36" "→ $1"; }
warn() { color "33" "! $1"; }
fail() { color "31" "✗ $1"; exit 1; }

if [[ "${1:-}" == "--down" ]]; then
  info "tearing down local backend stack"
  ( cd "$BACKEND_DIR" && docker-compose down -v )
  ok "done"
  exit 0
fi

[[ -d "$BACKEND_DIR" ]] || fail "the-backend-service not found at $BACKEND_DIR (set BACKEND_DIR)"

# 1. docker-compose up -d
if ! docker info >/dev/null 2>&1; then
  fail "Docker daemon isn't running. Start Docker Desktop and re-run."
fi
info "starting postgres + redis + keycloak via the-backend-service/docker-compose.yml"
( cd "$BACKEND_DIR" && docker-compose up -d )
ok "compose stack starting"

# 2. wait for Keycloak
info "waiting for Keycloak on $KEYCLOAK_URL"
for i in $(seq 1 60); do
  if curl -sS -o /dev/null -w "%{http_code}" "$KEYCLOAK_URL/realms/master" | grep -q "200"; then
    ok "Keycloak up"
    break
  fi
  sleep 2
  if [[ $i -eq 60 ]]; then
    warn "Keycloak didn't respond in 120s - check \`docker-compose logs keycloak\`"
  fi
done

# 3. backend .env
ENV_FILE="$BACKEND_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  info "generating $ENV_FILE from .env.example"
  cp "$BACKEND_DIR/.env.example" "$ENV_FILE"
  # Patch defaults that work with the local docker-compose stack.
  # Use sed with .bak for portability (macOS BSD sed).
  sed -i.bak \
    -e 's|^SUPABASE_DB_URI=.*|SUPABASE_DB_URI=postgresql://postgres:password@localhost:5432/openbox|' \
    -e 's|^REDIS_URL=.*|REDIS_URL=redis://localhost:6379|' \
    -e 's|^KEYCLOAK_BASE_URL=.*|KEYCLOAK_BASE_URL=http://localhost:8080|' \
    -e 's|^KEYCLOAK_REALM=.*|KEYCLOAK_REALM=openbox|' \
    -e 's|^KEYCLOAK_CLIENT_ID=.*|KEYCLOAK_CLIENT_ID=the-backend-service|' \
    -e 's|^KEYCLOAK_CLIENT_FE_ID=.*|KEYCLOAK_CLIENT_FE_ID=the-backend-service-fe|' \
    -e 's|^FRONTEND_URL=.*|FRONTEND_URL=http://localhost:3233|' \
    -e 's|^ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=http://localhost:3233|' \
    "$ENV_FILE"
  rm -f "$ENV_FILE.bak"
  ok "patched $ENV_FILE with local defaults"
  warn "you still need to set KEYCLOAK_CLIENT_SECRET, KEYCLOAK_CLIENT_FE_SECRET, CSRF_SECRET - see DEV.md"
else
  ok ".env already present at $ENV_FILE"
fi

# 4. node_modules
if [[ ! -d "$BACKEND_DIR/node_modules" ]]; then
  info "installing backend deps (yarn install)"
  ( cd "$BACKEND_DIR" && yarn install )
fi
ok "backend deps ready"

# 5. manual steps
cat <<'EOT'

── Remaining manual steps (one-time) ───────────────────────────────────────

  Open http://localhost:8080  (admin / admin - from docker-compose.yml)

  1. Create realm `openbox`
  2. In that realm, create client `the-backend-service`:
     - Client authentication: ON
     - Authentication flow: Service accounts roles
     - Copy the client secret → paste into $BACKEND_DIR/.env as
       KEYCLOAK_CLIENT_SECRET
  3. Create client `the-backend-service-fe`:
     - Client authentication: ON
     - Valid redirect URIs: http://localhost:3233/*
     - Copy the client secret → paste into $BACKEND_DIR/.env as
       KEYCLOAK_CLIENT_FE_SECRET
  4. Generate a random CSRF_SECRET and paste into .env
       openssl rand -hex 32
  5. Start the backend:
       cd $BACKEND_DIR && yarn start:dev
  6. Point the CLI at local:
       export OPENBOX_API_URL=http://localhost:3000
       openbox auth login  # login via browser against localhost FE

  Then run e2e tests against local:
       cd packages/cli
       OPENBOX_API_URL=http://localhost:3000 OPENBOX_ORG_ID=<your-org> npm run test:e2e
EOT
