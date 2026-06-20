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
  $hookTarget,
  $installTimeout,
  $installDefault,
  $activityVariant,
  $activityType,
  $activityLabels,
  $hookEventLabel,
  $providerCapabilities,
  $governProtocol,
  $backendPermissions,
  $sdkMethodNames,
} from './decorators.js';
export {
  getActivityType,
  getBackendPermissions,
  getHookEventLabel,
  getGovernProtocol,
  getProviderCapabilities,
  getSdkMethodNames,
} from './decorators.js';

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
    hookTarget: $hookTarget,
    installTimeout: $installTimeout,
    installDefault: $installDefault,
    activityVariant: $activityVariant,
    activityType: $activityType,
    activityLabels: $activityLabels,
    hookEventLabel: $hookEventLabel,
    providerCapabilities: $providerCapabilities,
    governProtocol: $governProtocol,
    backendPermissions: $backendPermissions,
    sdkMethodNames: $sdkMethodNames,
  },
};
