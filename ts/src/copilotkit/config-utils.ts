import { OpenBoxCoreClient } from '../core-client/core-client.js';
import { OPENBOX_RUNTIME_KEY_PATTERN } from './constants.js';
import {
  OpenBoxCopilotKitError,
  type OpenBoxCopilotKitConfig,
} from './types.js';

export function getRuntimeApiKey(
  config: OpenBoxCopilotKitConfig,
): string | undefined {
  return config.apiKey ?? process.env.OPENBOX_API_KEY;
}

export function getApprovalBackendApiKey(
  config: OpenBoxCopilotKitConfig,
): string | undefined {
  return (
    config.backendApiKey ??
    config.platformApiKey ??
    process.env.OPENBOX_BACKEND_API_KEY ??
    process.env.OPENBOX_PLATFORM_API_KEY
  );
}

export function createCoreClientResolver(config: OpenBoxCopilotKitConfig) {
  let coreClient: OpenBoxCoreClient | undefined = config.core;
  let coreClientCacheKey: string | undefined;

  return () => {
    if (config.core) return config.core;
    const apiKey = getRuntimeApiKey(config);
    const coreUrl = config.coreUrl ?? process.env.OPENBOX_CORE_URL;
    if (!apiKey) {
      throw new OpenBoxCopilotKitError(
        'OpenBox is enabled but the runtime API key is not configured.',
      );
    }
    if (!OPENBOX_RUNTIME_KEY_PATTERN.test(apiKey)) {
      throw new OpenBoxCopilotKitError(
        'OpenBox is enabled but the runtime API key must be an obx_live_* or obx_test_* key.',
      );
    }
    if (!coreUrl) {
      throw new OpenBoxCopilotKitError(
        'OpenBox is enabled but the Core URL is not configured.',
      );
    }
    const cacheKey = `${coreUrl}:${apiKey}`;
    if (!coreClient || coreClientCacheKey !== cacheKey) {
      coreClient = new OpenBoxCoreClient({ apiKey, apiUrl: coreUrl });
      coreClientCacheKey = cacheKey;
    }
    return coreClient;
  };
}

export function hasCoreRuntimeConfig(config: OpenBoxCopilotKitConfig): boolean {
  return Boolean(
    config.core ||
    (getRuntimeApiKey(config) &&
      (config.coreUrl ?? process.env.OPENBOX_CORE_URL)),
  );
}

export function hasApprovalBackendConfig(
  config: OpenBoxCopilotKitConfig,
): boolean {
  return Boolean(
    (config.apiUrl ?? process.env.OPENBOX_API_URL) &&
    getApprovalBackendApiKey(config),
  );
}
