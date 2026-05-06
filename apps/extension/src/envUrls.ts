// Mirror of the mobile auth helpers. Bundled URLs from the
// SDK's environments.json win when present (production, local); the
// process.env fallbacks fill blanks (staging is intentionally empty in
// the public SDK config so internal builds set it via .env.local).
//
// scripts/build.mjs reads .env.local and inlines OPENBOX_API_URL etc.
// via esbuild --define, so process.env values are baked at build time
// rather than read from the user's shell at runtime.
//
// Crucially the precedence is `bundled || envVar`, NOT the other way:
// a developer's .env.local with staging values must not silently
// override the user's production URL. Same rule mobile uses.

import { ENVIRONMENTS, type EnvConfig, type EnvName } from "openbox-sdk/env";

export function resolveExtensionUrls(env: EnvName): EnvConfig {
  const base = ENVIRONMENTS[env] ?? { apiUrl: "", coreUrl: "", platformUrl: "" };
  return {
    apiUrl: base.apiUrl || (process.env.OPENBOX_API_URL ?? ""),
    coreUrl: base.coreUrl || (process.env.OPENBOX_CORE_URL ?? ""),
    platformUrl: base.platformUrl || (process.env.OPENBOX_PLATFORM_URL ?? ""),
  };
}
