type Maturity = 'stable' | 'beta' | 'experimental';
/** Spec-driven CLI maturity table. Sourced from @cli_maturity in
 *  specs/typespec/cli/main.tsp. The lean CLI treats unlisted
 *  active commands as stable. */
declare const COMMAND_MATURITY: Record<string, Maturity>;

/** Spec-driven feature-flag table. Sourced from @feature_flag in
 *  specs/typespec/cli/main.tsp. */
declare const FEATURE_MATURITY: Record<string, Maturity>;

/** Programmatic override for the current maturity level. The CLI sets
 *  this from the top-level `--experimental` flag; library consumers
 *  can set it themselves to surface experimental commands in their UI. */
declare function setMaturityLevel(level: Maturity | null): void;
/** Resolve the current maturity level. Override > env > default 'stable'. */
declare function currentMaturityLevel(): Maturity;
/** True if a command at the target maturity is visible at the current
 *  level. The default `current` re-resolves on every call so consumers
 *  don't have to pass it explicitly. */
declare function isMaturityVisible(target: Maturity, current?: Maturity): boolean;
/** Look up a command path's declared maturity. Unlisted paths default
 *  to stable in the lean CLI. */
declare function maturityOf(path: string): Maturity;
/** Programmatic feature opt-in. CLI sets these from `--feature
 *  <name...>`; library consumers can pre-enable specific features. */
declare function enableFeature(name: string): void;
/** Like enableFeature but bulk. */
declare function enableFeatures(names: string[] | undefined): void;
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
declare function isFeatureEnabled(name: string): boolean;
/** Inventory of every registered feature flag with its current state. */
declare function listFeatures(): Array<{
    name: string;
    maturity: Maturity;
    enabled: boolean;
}>;

export { COMMAND_MATURITY, FEATURE_MATURITY, type Maturity, currentMaturityLevel, enableFeature, enableFeatures, isFeatureEnabled, isMaturityVisible, listFeatures, maturityOf, setMaturityLevel };
