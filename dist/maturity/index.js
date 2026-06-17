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
function isFeatureEnabled(name) {
  if (explicitlyEnabled.has(name)) return true;
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
