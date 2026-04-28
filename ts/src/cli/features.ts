// Feature flags - fine-grained gates for experimental BEHAVIOUR within
// otherwise-stable commands. Distinct from subcommand maturity:
//
//   maturity.ts  → "is this whole command stable enough to expose?"
//                  (gates `openbox foo` itself; subcommand visibility)
//   features.ts  → "is this experimental code path / option / branch
//                   inside an exposed command turned on?"
//
// A stable command can have an experimental feature (e.g.
// `openbox agent list` is stable, but `--include-deleted` is gated as
// `agent.list.include-deleted`). Code paths check `isFeatureEnabled(name)`
// and skip / take the experimental branch accordingly.
//
// Activation precedence:
//   1. CLI: `--feature <name>` (repeatable, exact-match opt-in)
//   2. ENV: `OPENBOX_FEATURES=name1,name2`
//   3. Maturity bridge: if a feature is registered as `experimental` and
//      the user has set `--experimental` / `OPENBOX_EXPERIMENTAL_LEVEL=
//      experimental`, every experimental feature flips on. Same for `beta`.
//      `stable` (the default) flips none on by default - features only
//      come on via #1 or #2.

import { isMaturityVisible, type Maturity } from './maturity.js';
import { ENV_VAR_BINDINGS } from '../env/generated/env-bindings.js';

/**
 * Registry of every known feature flag → maturity. Use a dotted path
 * scoped under the command that owns the flag, e.g.:
 *   'agent.list.include-deleted'
 *   'audit.deep-scan'
 *   'doctor.migrate-config-v2'
 *
 * Anything NOT in this registry returns `false` from `isFeatureEnabled`
 * unless explicitly opted in by name. Add an entry here when you
 * introduce a new experimental flag in a command - that way `--help`
 * tooling can surface which features exist.
 */
export const FEATURE_MATURITY: Record<string, Maturity> = {
  // Add as new experimental features land. Examples (commented):
  //   'agent.list.include-deleted':       'experimental',
  //   'audit.deep-scan':                   'experimental',
  //   'doctor.migrate-config-v2':          'experimental',
};

const explicitlyEnabled = new Set<string>();

/** Set by the CLI's `--feature <name...>` handler. Repeatable. */
export function setExplicitFeatures(names: string[] | undefined): void {
  if (!names) return;
  for (const n of names) {
    if (n && typeof n === 'string') explicitlyEnabled.add(n);
  }
}

/** Read the spec-driven features env var (comma-separated). Idempotent. */
function envFeatures(): Set<string> {
  const envName = ENV_VAR_BINDINGS.features.name;
  const raw = (process.env[envName] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return new Set(raw);
}

/**
 * True if `name` is enabled. Checked at runtime by code paths that
 * branch on a feature flag.
 *
 *   if (isFeatureEnabled('audit.deep-scan')) {
 *     // experimental branch
 *   }
 */
export function isFeatureEnabled(name: string): boolean {
  if (explicitlyEnabled.has(name)) return true;
  if (envFeatures().has(name)) return true;
  // Maturity bridge: if this feature is in the registry, see if the
  // current `--experimental` / `--beta` level subsumes it.
  const declared = FEATURE_MATURITY[name];
  if (declared && isMaturityVisible(declared)) return true;
  return false;
}

/** All registered feature names - used by `--features list`. */
export function listFeatures(): Array<{ name: string; maturity: Maturity; enabled: boolean }> {
  return Object.entries(FEATURE_MATURITY)
    .map(([name, maturity]) => ({ name, maturity, enabled: isFeatureEnabled(name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
