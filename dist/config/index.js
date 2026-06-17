// ts/src/config/host-config.ts
import * as fs from "fs";
function loadJsonConfig(file) {
  if (!fs.existsSync(file)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      out[k.toUpperCase().replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()] = String(v);
      out[k] = String(v);
    }
    return out;
  } catch {
    return {};
  }
}
function loadDotenv(file) {
  if (!fs.existsSync(file)) return {};
  try {
    const out = {};
    for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (val.startsWith('"') && val.endsWith('"') || val.startsWith("'") && val.endsWith("'")) {
        val = val.slice(1, -1);
      }
      out[key] = val;
    }
    return out;
  } catch {
    return {};
  }
}

// ts/src/config/store.ts
import { existsSync as existsSync2, mkdirSync, readFileSync as readFileSync2, writeFileSync } from "fs";
import { dirname } from "path";

// ts/src/env/os-paths.ts
import { join, resolve } from "path";
function openboxDataRoot() {
  const override = process.env.OPENBOX_HOME;
  if (override) return resolve(override);
  return resolve(process.cwd(), ".openbox");
}
var resolveOsPath = (scope) => {
  return join(openboxDataRoot(), scope);
};

// ts/src/config/store.ts
var CONFIG_KEY = /^[A-Z][A-Z0-9_]*$/;
function getPath() {
  return resolveOsPath("config");
}
function read() {
  const path = getPath();
  if (!existsSync2(path)) return {};
  const out = {};
  for (const line of readFileSync2(path, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (CONFIG_KEY.test(key)) out[key] = value;
  }
  return out;
}
function write(store) {
  const lines = ["# OpenBox CLI config; managed by `openbox config set/get/unset/list`."];
  for (const key of Object.keys(store).sort()) lines.push(`${key}=${store[key]}`);
  const path = getPath();
  const dir = dirname(path);
  if (!existsSync2(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, `${lines.join("\n")}
`, { mode: 384 });
}
function effectiveScope(_requested, _key) {
  return "project";
}
function setConfig(key, value) {
  if (!key) throw new Error("config key cannot be empty");
  if (!CONFIG_KEY.test(key)) throw new Error(`invalid config key: ${key}`);
  write({ ...read(), [key]: value });
  return { scope: "project", purged: 0 };
}
function getConfig(key) {
  return read()[key];
}
function unsetConfig(key) {
  const store = read();
  if (!(key in store)) return { scope: "project", removed: false };
  const { [key]: _removed, ...next } = store;
  write(next);
  return { scope: "project", removed: true };
}
function listConfig() {
  return read();
}
function configStorePath() {
  return getPath();
}
function applyConfigToProcessEnv() {
  for (const [key, value] of Object.entries(listConfig())) {
    if (process.env[key] === void 0) process.env[key] = value;
  }
}
export {
  applyConfigToProcessEnv,
  configStorePath,
  effectiveScope,
  getConfig,
  listConfig,
  loadDotenv,
  loadJsonConfig,
  setConfig,
  unsetConfig
};
