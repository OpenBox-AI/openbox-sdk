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

// ts/src/cli/generated/cli-maturity.ts
var COMMAND_MATURITY = {};

// ts/src/cli/generated/cli-features.ts
var FEATURE_MATURITY = {};

// ts/src/maturity/index.ts
var LEVEL = {
  stable: 0,
  beta: 1,
  experimental: 2
};
var consumerOverride = null;
var explicitlyEnabled = /* @__PURE__ */ new Set();
function setMaturityLevel(level) {
  consumerOverride = level;
}
function currentMaturityLevel() {
  if (consumerOverride) return consumerOverride;
  const envName = ENV_VAR_BINDINGS.experimentalLevel.name;
  const env = (process.env[envName] ?? "").toLowerCase();
  if (env === "experimental" || env === "beta" || env === "stable") return env;
  return "stable";
}
function isMaturityVisible(target, current = currentMaturityLevel()) {
  return LEVEL[target] <= LEVEL[current];
}
function maturityOf(path) {
  return COMMAND_MATURITY[path] ?? "stable";
}
function enableFeature(name) {
  if (name) explicitlyEnabled.add(name);
}
function enableFeatures(names) {
  if (!names) return;
  for (const n of names) {
    if (n && typeof n === "string") explicitlyEnabled.add(n);
  }
}
function envFeatures() {
  const envName = ENV_VAR_BINDINGS.features.name;
  const raw = (process.env[envName] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return new Set(raw);
}
function isFeatureEnabled(name) {
  if (explicitlyEnabled.has(name)) return true;
  if (envFeatures().has(name)) return true;
  const declared = FEATURE_MATURITY[name];
  if (declared && isMaturityVisible(declared)) return true;
  return false;
}
function listFeatures() {
  return Object.entries(FEATURE_MATURITY).map(([name, maturity]) => ({ name, maturity, enabled: isFeatureEnabled(name) })).sort((a, b) => a.name.localeCompare(b.name));
}
export {
  COMMAND_MATURITY,
  FEATURE_MATURITY,
  currentMaturityLevel,
  enableFeature,
  enableFeatures,
  isFeatureEnabled,
  isMaturityVisible,
  listFeatures,
  maturityOf,
  setMaturityLevel
};
