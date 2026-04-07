# OpenBox SDK

Modular TypeScript SDK for the OpenBox AI governance platform.

## Packages

| Package | Description |
|---------|-------------|
| `@openbox/types` | Shared types and response models |
| `@openbox/client` | Backend API client (`api.openbox.ai`) |
| `@openbox/core-client` | Governance API client (`core.openbox.ai`) |
| `@openbox/cli` | CLI tool |

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
openbox auth set-token <jwt>
openbox agent list
```

## Usage

```typescript
import { OpenBoxClient } from '@openbox/client';

const client = new OpenBoxClient({
  accessToken: '<jwt>',
});

const agents = await client.listAgents();
const pending = await client.getPendingApprovals(agentId);
await client.decideApproval(agentId, eventId, 'approve');
```

```typescript
import { OpenBoxCoreClient } from '@openbox/core-client';

const core = new OpenBoxCoreClient({
  apiKey: 'obx_live_...',
});

const verdict = await core.evaluate(payload);
```
