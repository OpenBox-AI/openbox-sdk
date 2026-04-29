// CLI integration over the public feature-flag gate. The pure query
// functions (isFeatureEnabled, listFeatures + the FEATURE_MATURITY
// registry) live in `openbox-sdk/maturity` so non-CLI consumers can
// gate their own experimental branches against the same spec.

import {
  enableFeatures,
  isFeatureEnabled,
  listFeatures,
  FEATURE_MATURITY,
  type Maturity,
} from '../maturity/index.js';

export { FEATURE_MATURITY, isFeatureEnabled, listFeatures };
export type { Maturity };

/** Set by the CLI's `--feature <name...>` handler. Repeatable.
 *  Forwards to the public registry so library consumers see the same
 *  set. */
export function setExplicitFeatures(names: string[] | undefined): void {
  enableFeatures(names);
}
