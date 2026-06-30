import { getConfig } from "@openbox-ai/openbox-sdk/config";

export interface ExtensionUrls {
  apiUrl: string;
  coreUrl: string;
  platformUrl?: string;
}

export function resolveExtensionUrls(): ExtensionUrls {
  // Mirror api.ts: env var THEN the SDK config file. Reading only env meant the
  // dashboard links / debug panel showed "(unset)" when URLs were config-based
  // even though the live client (api.ts, which reads getConfig) worked.
  return {
    apiUrl: process.env.OPENBOX_API_URL ?? getConfig("OPENBOX_API_URL") ?? "",
    coreUrl: process.env.OPENBOX_CORE_URL ?? getConfig("OPENBOX_CORE_URL") ?? "",
    platformUrl:
      process.env.OPENBOX_PLATFORM_URL ?? getConfig("OPENBOX_PLATFORM_URL") ?? undefined,
  };
}
