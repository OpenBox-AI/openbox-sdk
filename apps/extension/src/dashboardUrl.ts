// Per-env dashboard URL, derived from the SDK's platformUrl table
// (specs/environments.json). The Set API Key flow links here so users
// don't have to hunt for the dashboard. No domains hardcoded in this
// file: SDK is the source of truth, OPENBOX_DASHBOARD_URL env var is
// the local override, and an empty platformUrl (e.g. staging when
// publish-safety hardening blanks it) yields no link.

import type { EnvName } from "openbox-sdk/env";
import { resolveExtensionUrls } from "./envUrls";

export function dashboardBase(env: EnvName): string | undefined {
  const override = process.env.OPENBOX_DASHBOARD_URL;
  if (override) return override.replace(/\/$/, "");
  const platform = resolveExtensionUrls(env).platformUrl;
  if (!platform) return undefined;
  return platform.replace(/\/$/, "");
}

export function apiKeysUrl(env: EnvName): string | undefined {
  const base = dashboardBase(env);
  return base ? `${base}/organization?tab=api-keys` : undefined;
}
