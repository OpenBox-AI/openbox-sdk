// Thin extension shim over `openbox-sdk/client-factory` +
// `openbox-sdk/file-tokens`. The SDK owns env URL resolution, token
// IO, and `OpenBoxClient` construction; this file only adds the
// extension-flavored "no key configured" error message that points
// the user at the CLI install path.

import type { OpenBoxClient } from "openbox-sdk/client";
import type { EnvName } from "openbox-sdk/env";
import { createConsumerClient } from "openbox-sdk/client-factory";
import { loadApiKey as loadFileApiKey } from "openbox-sdk/file-tokens";

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
