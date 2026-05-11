// TypeSpec compiler entry; see ../env/src/index.ts for the rationale
// behind only exporting `$lib` and `$decorators`.

import {
  $verdict,
  $preset,
  $maps_to,
  $adapter,
  $hookEvent,
  $verdictShape,
  $activityRouting,
  $payloadShape,
  $noPayload,
  $installTarget,
  $installTimeout,
  $activityVariant,
  $activityType,
  $activityLabels,
} from './decorators.js';
export { getActivityType } from './decorators.js';

export { $lib } from './lib.js';

export const $decorators = {
  'OpenBox.Workflow': {
    verdict: $verdict,
    preset: $preset,
    maps_to: $maps_to,
    adapter: $adapter,
    hookEvent: $hookEvent,
    verdictShape: $verdictShape,
    activityRouting: $activityRouting,
    payloadShape: $payloadShape,
    noPayload: $noPayload,
    installTarget: $installTarget,
    installTimeout: $installTimeout,
    activityVariant: $activityVariant,
    activityType: $activityType,
    activityLabels: $activityLabels,
  },
};
