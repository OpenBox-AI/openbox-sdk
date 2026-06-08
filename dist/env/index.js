// ts/src/env/generated/env-bindings.ts
var ENV_VAR_BINDINGS = {
  apiUrl: { "name": "OPENBOX_API_URL" },
  coreUrl: { "name": "OPENBOX_CORE_URL" },
  platformUrl: { "name": "OPENBOX_PLATFORM_URL" },
  authUrl: { "name": "OPENBOX_AUTH_URL" },
  stackUrl: { "name": "OPENBOX_STACK_URL" },
  apiKey: { "name": "OPENBOX_API_KEY" },
  experimentalLevel: { "name": "OPENBOX_EXPERIMENTAL_LEVEL" },
  features: { "name": "OPENBOX_FEATURES" }
};
var API_KEY_PATTERN = /^obx_(?:live|test)_[0-9a-f]{48}$/;
function validateApiKeyFormat(value) {
  if (!API_KEY_PATTERN.test(value)) {
    return "OPENBOX_API_KEY must match obx_(live|test)_<48hex>";
  }
  return true;
}
var OS_PATH_FIELDS = ["path"];
var CLIENT_VARIANT_PATTERN = /^[A-Za-z0-9._+-]+$/;

// ts/src/env/connection.ts
function normalizeStackUrl(raw) {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("OpenBox stack URL cannot be empty.");
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);
  if (url.protocol !== "https:" && !isLoopbackHost(url.hostname)) {
    throw new Error("OpenBox stack URL must use https:// unless it points at localhost.");
  }
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}
function endpointsFromStackUrl(raw) {
  const stackUrl = normalizeStackUrl(raw);
  const url = new URL(stackUrl);
  const rootHost = url.hostname.replace(/^(api|core|auth)\./, "");
  const origin = `${url.protocol}//`;
  return {
    apiUrl: `${origin}api.${rootHost}/ob`,
    coreUrl: `${origin}core.${rootHost}/ob`,
    authUrl: `${origin}auth.${rootHost}/ob`,
    platformUrl: stackUrl
  };
}
var resolveConnection = (opts = {}) => {
  const stackUrl = opts.stackUrl ?? process.env[ENV_VAR_BINDINGS.stackUrl.name];
  const stackEndpoints = stackUrl ? endpointsFromStackUrl(stackUrl) : void 0;
  const apiUrl = requireUrl(
    "OPENBOX_API_URL",
    opts.apiUrl ?? process.env[ENV_VAR_BINDINGS.apiUrl.name] ?? stackEndpoints?.apiUrl
  );
  const coreUrl = requireUrl(
    "OPENBOX_CORE_URL",
    opts.coreUrl ?? process.env[ENV_VAR_BINDINGS.coreUrl.name] ?? stackEndpoints?.coreUrl
  );
  const platformUrl = opts.platformUrl ?? process.env[ENV_VAR_BINDINGS.platformUrl.name] ?? stackEndpoints?.platformUrl;
  const authUrl = opts.authUrl ?? process.env[ENV_VAR_BINDINGS.authUrl.name] ?? stackEndpoints?.authUrl;
  return {
    apiUrl,
    coreUrl,
    platformUrl,
    authUrl,
    stackUrl,
    displayName: opts.displayName ?? process.env.OPENBOX_STACK_NAME,
    source: stackUrl && !opts.apiUrl && !opts.coreUrl ? "stack-url" : "explicit"
  };
};
function requireUrl(name, value) {
  if (!value) throw new Error(`${name} is required. Set explicit OpenBox service URLs.`);
  return normalizeServiceUrl(name, value);
}
function normalizeServiceUrl(name, raw) {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error(`${name} cannot be empty.`);
  const url = new URL(trimmed);
  if (url.protocol !== "https:" && !isLoopbackHost(url.hostname)) {
    throw new Error(`${name} must use https:// unless it points at localhost.`);
  }
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}
function isLoopbackHost(host) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

// ts/src/env/token-codec.ts
function applyField(entry, field, value) {
  if (field === "ACCESS_TOKEN") return { ...entry, accessToken: value };
  if (field === "REFRESH_TOKEN") return { ...entry, refreshToken: value || void 0 };
  if (field === "API_KEY") return { ...entry, apiKey: value || void 0 };
  if (field === "UPDATED_AT") return { ...entry, updatedAt: value };
  if (field === "PERMISSIONS") {
    return {
      ...entry,
      permissions: value.split(",").map((s) => s.trim()).filter(Boolean)
    };
  }
  if (field === "FEATURES") {
    const features = value.split(",").reduce((acc, pair) => {
      const [key, rawValue] = pair.split(":").map((s) => s.trim());
      return key ? { ...acc, [key]: rawValue === "true" } : acc;
    }, {});
    return { ...entry, features };
  }
  return entry;
}
var parseTokenStore = (content) => {
  let store = {};
  for (const line of content.split("\n")) {
    const match = line.match(/^(\w+)=(.*)$/);
    if (!match) continue;
    store = applyField(store, match[1], match[2]);
  }
  return store;
};
var serializeTokenStore = (store) => {
  const lines = [];
  if (store.accessToken) {
    lines.push(`ACCESS_TOKEN=${store.accessToken}`);
    lines.push(`REFRESH_TOKEN=${store.refreshToken ?? ""}`);
  }
  if (store.apiKey) lines.push(`API_KEY=${store.apiKey}`);
  if (store.accessToken || store.apiKey) lines.push(`UPDATED_AT=${store.updatedAt ?? ""}`);
  if (store.permissions && store.permissions.length > 0) {
    lines.push(`PERMISSIONS=${store.permissions.join(",")}`);
  }
  if (store.features && Object.keys(store.features).length > 0) {
    const pairs = Object.entries(store.features).map(([key, value]) => `${key}:${value}`);
    lines.push(`FEATURES=${pairs.join(",")}`);
  }
  return lines.length > 0 ? `${lines.join("\n")}
` : "";
};

// ts/src/env/client-name.ts
var resolveClientName = (base, variant) => {
  const raw = variant ?? process.env.OPENBOX_CLIENT_VARIANT;
  if (!raw) return base;
  const trimmed = raw.trim();
  if (!trimmed) return base;
  if (!CLIENT_VARIANT_PATTERN.test(trimmed)) {
    console.error(
      `[openbox] OPENBOX_CLIENT_VARIANT='${trimmed}' contains invalid characters; ignoring. Allowed: letters, digits, '.', '_', '+', '-'.`
    );
    return base;
  }
  return `${base}/${trimmed}`;
};

// ts/src/env/auth-header.ts
function buildAuthHeader(creds) {
  if (creds.apiKey) return { "X-API-Key": creds.apiKey };
  if (creds.accessToken) return { Authorization: `Bearer ${creds.accessToken}` };
  return {};
}
export {
  CLIENT_VARIANT_PATTERN,
  ENV_VAR_BINDINGS,
  OS_PATH_FIELDS,
  buildAuthHeader,
  endpointsFromStackUrl,
  normalizeStackUrl,
  parseTokenStore,
  resolveClientName,
  resolveConnection,
  serializeTokenStore,
  validateApiKeyFormat
};
