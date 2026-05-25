export interface ExtensionUrls {
  apiUrl: string;
  coreUrl: string;
  platformUrl?: string;
}

export function resolveExtensionUrls(): ExtensionUrls {
  return {
    apiUrl: process.env.OPENBOX_API_URL ?? "",
    coreUrl: process.env.OPENBOX_CORE_URL ?? "",
    platformUrl: process.env.OPENBOX_PLATFORM_URL,
  };
}
