# OpenBox SDK

Modular TypeScript SDK for the OpenBox AI governance platform.

## Packages

| Package | Description |
|---------|-------------|
| `openbox-sdk/types` | Shared types and response models |
| `openbox-sdk/client` | Backend API client (`api.openbox.ai`) |
| `openbox-sdk/core-client` | Governance API client (`core.openbox.ai`) |
| `openbox-sdk/cli` | CLI tool |

## Setup

```bash
git clone https://github.com/OpenBox-AI/openbox-sdk.git
cd openbox-sdk
npm install
npm run build
```

## CLI

```bash
npm link -w packages/cli

# Browser login (opens Chrome, grabs token after you log in)
openbox auth login

# Or set token manually
openbox auth set-token <jwt>

openbox agent list
```

Requires `playwright` for browser login: `npm install playwright`

## Usage

```typescript
import { OpenBoxClient } from 'openbox-sdk/client';

const client = new OpenBoxClient({
  accessToken: '<jwt>',
});

const agents = await client.listAgents();
const pending = await client.getPendingApprovals(agentId);
await client.decideApproval(agentId, eventId, 'approve');
```

```typescript
import { OpenBoxCoreClient } from 'openbox-sdk/core-client';

const core = new OpenBoxCoreClient({
  apiKey: 'obx_live_...',
});

const verdict = await core.evaluate(payload);
```
