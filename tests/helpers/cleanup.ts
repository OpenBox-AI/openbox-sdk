import { getBackendClient } from './api-client';

interface TrackedResource {
  type: 'agent' | 'guardrail' | 'policy' | 'behavior-rule';
  id: string;
  agentId?: string;
}

const tracked: TrackedResource[] = [];

export function trackResource(resource: TrackedResource) {
  tracked.push(resource);
}

export async function cleanupAll() {
  const client = getBackendClient();

  // Delete in reverse order (children before parents)
  const reversed = [...tracked].reverse();

  for (const resource of reversed) {
    try {
      switch (resource.type) {
        case 'guardrail':
          await client.delete(`/agent/${resource.agentId}/guardrails/${resource.id}`);
          break;
        case 'policy':
          // Policies can't be deleted via API, just deactivate
          await client.put(`/agent/${resource.agentId}/policies/${resource.id}`, {
            is_active: false,
          });
          break;
        case 'behavior-rule':
          await client.delete(`/agent/${resource.agentId}/behavior-rule/${resource.id}`);
          break;
        case 'agent':
          await client.delete(`/agent/${resource.id}`);
          break;
      }
    } catch (err: any) {
      console.warn(`Cleanup failed for ${resource.type} ${resource.id}: ${err.message || err}`);
    }
  }

  tracked.length = 0;
}
