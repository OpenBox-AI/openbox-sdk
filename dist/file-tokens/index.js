// ts/src/file-tokens/index.ts
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2, writeFileSync as writeFileSync2 } from "fs";
import { dirname as dirname2, resolve } from "path";

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

// ts/src/env/os-paths.ts
import { homedir } from "os";
import { join } from "path";
function openboxDataRoot() {
  const override = process.env.OPENBOX_HOME;
  if (override) return override;
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "openbox");
  }
  if (process.platform === "linux") {
    const xdg = process.env.XDG_DATA_HOME;
    if (xdg) return join(xdg, "openbox");
  }
  return join(homedir(), ".openbox");
}
var resolveOsPath = (scope) => {
  return join(openboxDataRoot(), scope);
};

// ts/src/file-tokens/agent-keys.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
function getPath() {
  const path = resolveOsPath("agent-keys");
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return path;
}
function read() {
  const path = getPath();
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function write(store) {
  writeFileSync(getPath(), JSON.stringify(store, null, 2) + "\n", { mode: 384 });
}
function recordAgentKey(agentId, runtimeKey, agentName) {
  if (!agentId || !runtimeKey) return;
  if (!runtimeKey.startsWith("obx_live_") && !runtimeKey.startsWith("obx_test_")) return;
  const store = read();
  store[agentId] = {
    agentId,
    agentName,
    runtimeKey,
    recordedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  write(store);
}
function recallAgentKey(agentId) {
  return read()[agentId] ?? null;
}
function agentKeysPath() {
  return getPath();
}

// ts/src/file-tokens/index.ts
function getTokenPath() {
  const projectTokens = resolve(process.cwd(), ".tokens");
  if (existsSync2(projectTokens)) return projectTokens;
  const path = resolveOsPath("tokens");
  const dir = dirname2(path);
  if (!existsSync2(dir)) mkdirSync2(dir, { recursive: true });
  return path;
}
function readTokenStore() {
  const path = getTokenPath();
  if (!existsSync2(path)) return {};
  return parseTokenStore(readFileSync2(path, "utf-8"));
}
function loadApiKey() {
  return process.env.OPENBOX_BACKEND_API_KEY ?? process.env.OPENBOX_API_KEY ?? readTokenStore().apiKey;
}
function saveApiKey(apiKey) {
  const path = getTokenPath();
  const store = readTokenStore();
  const {
    permissions: _permissions,
    features: _features,
    ...storeWithoutPrincipalMetadata
  } = store;
  writeFileSync2(
    path,
    serializeTokenStore({
      ...storeWithoutPrincipalMetadata,
      apiKey,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    }),
    { mode: 384 }
  );
}
function clearApiKey() {
  const path = getTokenPath();
  const store = readTokenStore();
  if (!store.apiKey) return false;
  const { apiKey: _apiKey, ...next } = store;
  writeFileSync2(path, serializeTokenStore(next), { mode: 384 });
  return true;
}
function hasApiKey() {
  return loadApiKey() !== void 0;
}
export {
  agentKeysPath,
  clearApiKey,
  getTokenPath,
  hasApiKey,
  loadApiKey,
  readTokenStore,
  recallAgentKey,
  recordAgentKey,
  saveApiKey
};
