import { resolveExtensionUrls } from "./envUrls";

export function dashboardBase(): string | undefined {
  const platform = resolveExtensionUrls().platformUrl;
  if (!platform) return undefined;
  return platform.replace(/\/$/, "");
}

export function apiKeysUrl(): string | undefined {
  const base = dashboardBase();
  return base ? `${base}/organization?tab=api-keys` : undefined;
}
