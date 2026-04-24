# Local Backend Stand-up

For running the openbox-sdk CLI e2e tests (and destructive commands like
`team create/delete`, `agent create/delete`, `member invite`, etc.) against a
local OpenBox backend instead of staging.

The staging backend at `https://openbox-api.node.lat` is already running the
latest `the-backend-service` main, so most testing does NOT need a local stack.
Use this guide when:

- You need isolated test state that doesn't touch staging
- You're working on a backend change and need the CLI to hit an un-deployed
  branch
- You want to test the CLI against a backend commit newer than staging's
  auto-deploy

## Requirements

- Docker Desktop running (for postgres + redis + keycloak containers)
- `yarn` (backend uses yarn)
- Node 23+ (backend targets node 23)
- `the-backend-service` cloned at `the workspace/the-backend-service`
  (override with `BACKEND_DIR=<path>` when invoking the helper script)

## Steps

### 1. Bring up the stack

```bash
bash scripts/local-backend-up.sh
```

This brings up postgres + redis + keycloak via
`the-backend-service/docker-compose.yml`, waits for Keycloak to respond, generates
a `.env` with local-stack defaults patched in, and runs `yarn install` if
needed. It **does not** bootstrap Keycloak - that's step 2.

### 2. Bootstrap Keycloak (one-time)

Open `http://localhost:8080` and log in as `admin` / `admin`.

1. **Create realm** `openbox`.
2. **Create client `the-backend-service`** inside that realm:
   - Client authentication: **ON**
   - Authentication flow → Service accounts roles enabled
   - Copy the generated client secret → paste into
     `the workspace/the-backend-service/.env` as
     `KEYCLOAK_CLIENT_SECRET=...`
3. **Create client `the-backend-service-fe`**:
   - Client authentication: **ON**
   - Valid redirect URIs: `http://localhost:3233/*` (or wherever your FE runs)
   - Copy the client secret → paste into `.env` as
     `KEYCLOAK_CLIENT_FE_SECRET=...`
4. **Generate a CSRF secret** and paste into `.env` as `CSRF_SECRET=...`:
   ```bash
   openssl rand -hex 32
   ```

### 3. Start the backend

```bash
cd the workspace/the-backend-service
yarn start:dev
```

Migrations run automatically on first boot against the dockerized postgres.
Backend listens on port 3000.

### 4. Point the CLI at localhost

```bash
export OPENBOX_API_URL=http://localhost:3000
openbox auth login   # opens browser → Keycloak on localhost
```

You'll need to have created at least one user in the `openbox` realm via the
Keycloak admin UI for login to succeed. Give that user the `Admin` composite
role (the backend auto-creates it on first boot; assign via the realm's
Users → Role mapping).

### 5. Run the e2e tests

```bash
cd packages/cli
OPENBOX_API_URL=http://localhost:3000 OPENBOX_ORG_ID=<your-local-org> npm run test:e2e
```

The test suite's `team-lifecycle.test.ts` exercises the full destructive
round-trip (create → get → list → delete) against your local backend and
verifies real HTTP behavior end-to-end.

## Teardown

```bash
bash scripts/local-backend-up.sh --down
```

Stops the compose stack and removes the postgres/redis/keycloak volumes.

## Not included

- Local **the-core-service** (the Go service at port 8086 for runtime governance
  evaluation). Only needed when testing agent-emitted events against local;
  for CLI-only coverage, the backend is sufficient. See
  `the workspace/the-core-service/docker-compose.yml` for that stack.
- Local **the-dashboard-fe** - not needed for CLI testing. Login uses Keycloak's
  built-in login page when no redirect is configured.
- Local **AWS KMS / S3 / SES** - backend has plaintext-fallback mode when
  `KMS_*` env vars are empty. Good enough for CLI testing; email-sending
  flows (invitation) won't deliver but they'll succeed at the HTTP level.
