// Thin extension shim over the SDK's token + client surfaces. The SDK
// owns env URL resolution (`openbox-sdk/env`), token I/O
// (`openbox-sdk/file-tokens`), and `OpenBoxClient` construction
// (`openbox-sdk/client-factory`); this file only adds the
// extension-flavored "no key configured" error message and the
// debug-friendly `apiKeyPrefix` helper.

import type { OpenBoxClient } from "openbox-sdk/client";
import type { EnvName } from "openbox-sdk/env";
import { validateApiKeyFormat } from "openbox-sdk/env";
import {
  loadApiKey as loadFileApiKey,
  saveApiKey as saveFileApiKey,
  clearApiKey as clearFileApiKey,
  hasApiKey as hasFileApiKey,
  readTokenStore,
} from "openbox-sdk/file-tokens";
import { createConsumerClient } from "openbox-sdk/client-factory";

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
 *  prefix non-sensitive — entropy is in the trailing hex. Used for
 *  debug display so the user has SOMETHING that uniquely identifies
 *  the key at a glance even when the backend's listApiKeys is
 *  unreachable. */
export function apiKeyPrefix(env: EnvName, length = 16): string | undefined {
  const k = loadFileApiKey(env);
  if (!k) return undefined;
  return k.length > length ? `${k.slice(0, length)}…` : k;
}

function loadApiKey(env: EnvName): string {
  const key = loadFileApiKey(env);
  if (!key) {
    const flag = env === "production" ? "" : `--env ${env} `;
    throw new Error(
      `No X-API-Key for env '${env}'. Either:\n` +
        `  • Mint one in the OpenBox dashboard and run \`openbox ${flag}auth set-api-key\`\n` +
        `  • Or set \`openbox.mockAuth\` in settings to run the UI with fixtures (no backend).`,
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
    getApiKey: () => loadApiKey(env),
    clientName: "apps/extension",
  });
  return { client: ctx.client, apiBase: ctx.apiBase };
}
