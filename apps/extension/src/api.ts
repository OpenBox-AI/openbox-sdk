import type { OpenBoxClient } from "@openbox-ai/openbox-sdk/client";
import { validateApiKeyFormat } from "@openbox-ai/openbox-sdk/env";
import {
  loadApiKey as loadFileApiKey,
  saveApiKey as saveFileApiKey,
  clearApiKey as clearFileApiKey,
  hasApiKey as hasFileApiKey,
  readTokenStore,
} from "@openbox-ai/openbox-sdk/file-tokens";
import { createConsumerClient } from "@openbox-ai/openbox-sdk/client-factory";
import { getConfig } from "@openbox-ai/openbox-sdk/config";

export const clearApiKey = clearFileApiKey;
export const writeApiKey = saveFileApiKey;
export const hasApiKey = hasFileApiKey;
export const readStore = readTokenStore;

export function validateApiKey(key: string): boolean {
  try {
    validateApiKeyFormat(key);
    return true;
  } catch {
    return false;
  }
}

export function apiKeyPrefix(length = 16): string | undefined {
  const key = loadFileApiKey();
  if (!key) return undefined;
  return key.length > length ? `${key.slice(0, length)}…` : key;
}

function loadApiKey(): string {
  const key = loadFileApiKey();
  if (!key) {
    throw new Error(
      "OpenBox is not connected. Add the OpenBox key provided by your organization.",
    );
  }
  return key;
}

export async function createApi(): Promise<OpenBoxClient> {
  return (await createApiContext()).client;
}

export async function createApiContext(): Promise<{
  client: OpenBoxClient;
  apiBase: string;
}> {
  const ctx = await createConsumerClient({
    apiUrl: process.env.OPENBOX_API_URL ?? getConfig("OPENBOX_API_URL") ?? undefined,
    coreUrl: process.env.OPENBOX_CORE_URL ?? getConfig("OPENBOX_CORE_URL") ?? undefined,
    authUrl: process.env.OPENBOX_AUTH_URL ?? getConfig("OPENBOX_AUTH_URL") ?? undefined,
    platformUrl: process.env.OPENBOX_PLATFORM_URL ?? getConfig("OPENBOX_PLATFORM_URL") ?? undefined,
    stackUrl: process.env.OPENBOX_STACK_URL ?? getConfig("OPENBOX_STACK_URL") ?? undefined,
    getApiKey: () => loadApiKey(),
    clientName: "apps/extension",
  });
  return { client: ctx.client, apiBase: ctx.apiBase };
}
