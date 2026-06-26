import { normalizeServiceUrl } from '../env/connection.js';

export const DEFAULT_OPENBOX_CORE_URL = 'https://core.openbox.ai';

export function resolveInstallRuntimeCoreUrl(options: {
  coreUrl?: string;
  existingCoreUrl?: string;
  runtimeEnv: Record<string, string | undefined>;
}): string | undefined {
  const hasRuntimeMaterial = Object.entries(options.runtimeEnv).some(
    ([key, value]) => key !== 'OPENBOX_CORE_URL' && value !== undefined,
  );
  if (
    options.coreUrl === undefined &&
    options.existingCoreUrl === undefined &&
    !hasRuntimeMaterial
  ) {
    return undefined;
  }
  return normalizeServiceUrl(
    'OPENBOX_CORE_URL',
    options.coreUrl ?? options.existingCoreUrl ?? DEFAULT_OPENBOX_CORE_URL,
  );
}
