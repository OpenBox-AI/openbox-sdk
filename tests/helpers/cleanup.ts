import { getBackendClient } from "./api-client";

interface TrackedResource {
  type: "agent" | "guardrail" | "policy" | "behavior-rule";
  id: string;
  agentId?: string;
}

const tracked: TrackedResource[] = [];
const CLEANUP_CONCURRENCY = Number(
  process.env.OPENBOX_E2E_CLEANUP_CONCURRENCY ?? 4,
);

export function trackResource(resource: TrackedResource) {
  tracked.push(resource);
}

function cleanupKey(resource: TrackedResource) {
  return [
    resource.type,
    resource.agentId ?? "",
    resource.id,
  ].join(":");
}

function uniqueResources(resources: readonly TrackedResource[]) {
  const seen = new Set<string>();
  const deduped: TrackedResource[] = [];

  for (const resource of resources) {
    const key = cleanupKey(resource);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(resource);
  }

  return deduped;
}

async function mapLimit<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
) {
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        await fn(items[index]);
      }
    }),
  );
}

export async function cleanupAll() {
  const client = getBackendClient();

  // Agent deletion cascades owned governance resources in the backend. Prefer
  // that path so cleanup does not force one OPA rebuild per behavior rule.
  const reversed = uniqueResources([...tracked].reverse());
  const agentResources = reversed.filter(
    (resource) => resource.type === "agent",
  );
  const trackedAgentIds = new Set(agentResources.map((resource) => resource.id));
  const failedAgentIds = new Set<string>();

  async function cleanupResource(resource: TrackedResource): Promise<boolean> {
    try {
      switch (resource.type) {
        case "guardrail":
          await client.delete(
            `/agent/${resource.agentId}/guardrails/${resource.id}`,
          );
          break;
        case "policy":
          // Policies can't be deleted via API, just deactivate
          await client.put(
            `/agent/${resource.agentId}/policies/${resource.id}`,
            {
              is_active: false,
            },
          );
          break;
        case "behavior-rule":
          await client.delete(
            `/agent/${resource.agentId}/behavior-rule/${resource.id}`,
          );
          break;
        case "agent":
          await client.delete(`/agent/${resource.id}`);
          break;
      }
      return true;
    } catch (err: any) {
      console.warn(
        `Cleanup failed for ${resource.type} ${resource.id}: ${err.message || err}`,
      );
      return false;
    }
  }

  await mapLimit(
    agentResources,
    Math.min(CLEANUP_CONCURRENCY, 2),
    async (resource) => {
      if (!(await cleanupResource(resource))) {
        failedAgentIds.add(resource.id);
      }
    },
  );

  const childResources = reversed.filter((resource) => {
    if (resource.type === "agent") return false;
    if (!resource.agentId) return true;
    return !trackedAgentIds.has(resource.agentId) || failedAgentIds.has(resource.agentId);
  });

  await mapLimit(
    childResources,
    CLEANUP_CONCURRENCY,
    async (resource) => {
      await cleanupResource(resource);
    },
  );

  tracked.length = 0;
}
