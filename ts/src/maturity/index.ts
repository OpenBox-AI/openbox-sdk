// Public sub-path: `import { ... } from 'openbox-sdk/maturity'`.
//
// Spec-driven gating logic; pure query functions that consume the
// COMMAND_MATURITY / FEATURE_MATURITY tables emitted from
// `specs/typespec/cli/main.tsp`. The CLI uses these to hide
// experimental commands; UI/IDE/dashboard consumers can use the same
// functions to gate their own surfaces against the same spec.
//
// Two levels:
//   * Maturity (whole-command); `isMaturityVisible(target)` + the
//     COMMAND_MATURITY map keyed by space-separated path.
//   * Feature flags (within-command experimental branches) .
//     `isFeatureEnabled(name)` + the FEATURE_MATURITY registry.
//
// CLI-specific glue (Commander integration, --experimental flag
// handler, --feature flag handler) lives in `cli/maturity.ts` and
// `cli/features.ts`.

import { ENV_VAR_BINDINGS } from '../env/generated/env-bindings.js';
import { COMMAND_MATURITY, type Maturity } from '../cli/generated/cli-maturity.js';
import { FEATURE_MATURITY } from '../cli/generated/cli-features.js';

export type { Maturity };
export { COMMAND_MATURITY, FEATURE_MATURITY };

const LEVEL: Record<Maturity, number> = {
  stable: 0,
  beta: 1,
  experimental: 2,
};

let consumerOverride: Maturity | null = null;
const explicitlyEnabled = new Set<string>();

/** Programmatic override for the current maturity level. The CLI sets
 *  this from the top-level `--experimental` flag; library consumers
 *  can set it themselves to surface experimental commands in their UI. */
export function setMaturityLevel(level: Maturity | null): void {
  consumerOverride = level;
}

/** Resolve the current maturity level. Override > env > default 'stable'. */
export function currentMaturityLevel(): Maturity {
  if (consumerOverride) return consumerOverride;
  const envName = ENV_VAR_BINDINGS.experimentalLevel.name;
  const env = (process.env[envName] ?? '').toLowerCase();
  if (env === 'experimental' || env === 'beta' || env === 'stable') return env;
  return 'stable';
}

/** True if a command at the target maturity is visible at the current
 *  level. The default `current` re-resolves on every call so consumers
 *  don't have to pass it explicitly. */
export function isMaturityVisible(target: Maturity, current = currentMaturityLevel()): boolean {
  return LEVEL[target] <= LEVEL[current];
}

/** Look up a command path's declared maturity (e.g. 'agent list').
 *  Unlisted paths default to 'experimental'; same conservative
 *  default the CLI uses. */
export function maturityOf(path: string): Maturity {
  return COMMAND_MATURITY[path] ?? 'experimental';
}

// ─── Feature flags ────────────────────────────────────────────────────

/** Programmatic feature opt-in. CLI sets these from `--feature
 *  <name...>`; library consumers can pre-enable specific features. */
export function enableFeature(name: string): void {
  if (name) explicitlyEnabled.add(name);
}

/** Like enableFeature but bulk. */
export function enableFeatures(names: string[] | undefined): void {
  if (!names) return;
  for (const n of names) {
    if (n && typeof n === 'string') explicitlyEnabled.add(n);
  }
}

function envFeatures(): Set<string> {
  const envName = ENV_VAR_BINDINGS.features.name;
  const raw = (process.env[envName] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return new Set(raw);
}

/**
 * True if `name` is enabled. Resolution order:
 *   1. Explicitly enabled via `enableFeature(name)`.
 *   2. Listed in OPENBOX_FEATURES env var (comma-separated).
 *   3. Maturity bridge: feature is registered in FEATURE_MATURITY at
 *      a level the current maturity level subsumes.
 *
 * Example:
 *   if (isFeatureEnabled('audit.deep-scan')) { ... }
 */
export function isFeatureEnabled(name: string): boolean {
  if (explicitlyEnabled.has(name)) return true;
  if (envFeatures().has(name)) return true;
  const declared = FEATURE_MATURITY[name];
  if (declared && isMaturityVisible(declared)) return true;
  return false;
}

/** Inventory of every registered feature flag with its current state. */
export function listFeatures(): Array<{ name: string; maturity: Maturity; enabled: boolean }> {
  return Object.entries(FEATURE_MATURITY)
    .map(([name, maturity]) => ({ name, maturity, enabled: isFeatureEnabled(name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
