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
  $spanContract,
  $agentIdentityContract,
  $governProtocol,
  $backendPermissions,
  $sdkMethodNames,
  $sdkTargets,
} from './decorators.js';
export {
  getActivityType,
  getBackendPermissions,
  getHookEventLabel,
  getGovernProtocol,
  getProviderCapabilities,
  getSpanContract,
  getAgentIdentityContract,
  getSdkMethodNames,
  getSdkTargets,
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
    spanContract: $spanContract,
    agentIdentityContract: $agentIdentityContract,
    governProtocol: $governProtocol,
    backendPermissions: $backendPermissions,
    sdkMethodNames: $sdkMethodNames,
    sdkTargets: $sdkTargets,
  },
};
