// Thin extension shim over the SDK's token + client surfaces. The SDK
// owns URL resolution, token I/O, and `OpenBoxClient` construction;
// this file only adds the extension-flavored "no key configured" error
// message and the debug-friendly `apiKeyPrefix` helper.

import type { OpenBoxClient } from "openbox-sdk/client";
import { type EnvName } from "openbox-sdk/env";
import { validateApiKeyFormat } from "openbox-sdk/env";
import {
  loadApiKey as loadFileApiKey,
  saveApiKey as saveFileApiKey,
  clearApiKey as clearFileApiKey,
  hasApiKey as hasFileApiKey,
  readTokenStore,
} from "openbox-sdk/file-tokens";
import { createConsumerClient } from "openbox-sdk/client-factory";
import { getConfig } from "openbox-sdk/cli/config-store";

// Re-export the SDK helpers under the names the rest of the extension
// already uses, so call sites don't have to know whether the work
// happens in the SDK or here.
export const clearApiKey = clearFileApiKey;
export const writeApiKey = saveFileApiKey;
export const hasApiKey = hasFileApiKey;
export const readStore = readTokenStore;

/** Validate that a key matches the org-API-key wire shape
 *  (`obx_key_<48 hex>`). Returns true / false; the SDK throws on
 *  malformed shapes via `validateApiKeyFormat`, so we wrap that to
 *  keep the call site UX-friendly (silent boolean, no exception). */
export function validateApiKey(key: string): boolean {
  try {
    validateApiKeyFormat(key);
    return true;
  } catch {
    return false;
  }
}

/** First N chars of the secret. The shape `obx_key_<48 hex>` makes the
 *  prefix non-sensitive - entropy is in the trailing hex. Used for
 *  debug display so the user has SOMETHING that uniquely identifies
 *  the key at a glance even when account metadata is unreachable. */
export function apiKeyPrefix(env: EnvName, length = 16): string | undefined {
  const k = loadFileApiKey(env);
  if (!k) return undefined;
  return k.length > length ? `${k.slice(0, length)}…` : k;
}

function loadApiKey(env: EnvName): string {
  const key = loadFileApiKey(env);
  if (!key) {
    throw new Error(
      "OpenBox is not connected. Add the OpenBox key provided by your organization.",
    );
  }
  return key;
}

export async function createApi(env: EnvName): Promise<OpenBoxClient> {
  return (await createApiContext(env)).client;
}

/**
 * Returns the configured client + the resolved API base, so the
 * caller can show "Signed in to <apiBase>" without re-resolving env.
 */
export async function createApiContext(env: EnvName): Promise<{
  client: OpenBoxClient;
  apiBase: string;
}> {
  const ctx = await createConsumerClient({
    envName: env,
    apiUrl: getConfig("global", "OPENBOX_API_URL") ?? undefined,
    coreUrl: getConfig("global", "OPENBOX_CORE_URL") ?? undefined,
    authUrl: getConfig("global", "OPENBOX_AUTH_URL") ?? undefined,
    platformUrl: getConfig("global", "OPENBOX_PLATFORM_URL") ?? undefined,
    stackUrl: getConfig("global", "OPENBOX_STACK_URL") ?? undefined,
    getApiKey: () => loadApiKey(env),
    clientName: "apps/extension",
  });
  return { client: ctx.client, apiBase: ctx.apiBase };
}
