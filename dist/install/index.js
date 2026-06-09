// ts/src/install/from-spec.ts
import fs from "fs";
import path from "path";
function resolveInstallPaths(spec, options = {}) {
  const scope = options.scope ?? "project";
  const cwd = options.cwd ?? process.cwd();
  if (scope !== "project") {
    throw new Error(`scope \`${scope}\` is not supported; expected project`);
  }
  if (spec.style === "claude-array") {
    return {
      scope,
      hooksFile: path.join(cwd, ".claude", "settings.json"),
      configDir: path.join(cwd, ".claude-hooks"),
      mcpFile: path.join(cwd, ".mcp.json"),
      mcpKey: "mcpServers"
    };
  }
  return {
    scope,
    hooksFile: path.join(cwd, ".cursor", "hooks.json"),
    configDir: path.join(cwd, ".cursor-hooks"),
    mcpFile: path.join(cwd, ".cursor", "mcp.json"),
    mcpKey: "mcpServers"
  };
}
function loadJson(file) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf-8"));
    }
  } catch {
  }
  return {};
}
function saveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf-8");
}
function ruleIsOpenBox(rule, command) {
  return rule.hooks?.some(
    (h) => h.command === command || h.command?.includes("openbox claude-code") || h.command?.includes("openbox cursor")
  ) ?? false;
}
function isCursorOpenBoxHook(value, command) {
  if (!value) return false;
  if (Array.isArray(value)) {
    return value.some((e) => isCursorOpenBoxHook(e, command));
  }
  if (typeof value !== "object") return false;
  const cmd = value.command;
  return cmd === command || cmd?.includes("openbox cursor") === true;
}
function dropExampleConfig(configDir) {
  fs.mkdirSync(configDir, { recursive: true });
  const file = path.join(configDir, "config.json");
  if (fs.existsSync(file)) return;
  const example = {
    OPENBOX_API_KEY: "obx_live_YOUR_API_KEY_HERE",
    OPENBOX_CORE_URL: "https://core.example/ob",
    GOVERNANCE_POLICY: "fail_open",
    HITL_ENABLED: true,
    HITL_MAX_WAIT: 300,
    VERBOSE: false,
    DRY_RUN: true
  };
  fs.writeFileSync(file, JSON.stringify(example, null, 2) + "\n", { mode: 384, encoding: "utf-8" });
  console.log(`Created example config at ${file}`);
  console.log("  -> Set OPENBOX_API_KEY and DRY_RUN=false to enable governance");
}
function installAdapter(spec, options = {}) {
  const paths = resolveInstallPaths(spec, options);
  const settings = loadJson(paths.hooksFile);
  if (spec.style === "claude-array") {
    let hooksBlock = settings[spec.key];
    if (!hooksBlock) {
      hooksBlock = {};
      settings[spec.key] = hooksBlock;
    }
    for (const evt of spec.events) {
      if (!hooksBlock[evt.name]) hooksBlock[evt.name] = [];
      hooksBlock[evt.name] = hooksBlock[evt.name].filter((r) => !ruleIsOpenBox(r, spec.command));
      const inner = { type: "command", command: spec.command };
      if (evt.timeout) inner.timeout = evt.timeout;
      hooksBlock[evt.name].push({ hooks: [inner] });
    }
  } else {
    let hooksBlock = settings[spec.key];
    if (!hooksBlock) {
      hooksBlock = {};
      settings[spec.key] = hooksBlock;
    }
    for (const evt of spec.events) {
      const entry = { command: spec.command };
      if (evt.timeout) entry.timeout = evt.timeout;
      if (evt.matcher) entry.matcher = evt.matcher;
      hooksBlock[evt.name] = [entry];
    }
  }
  saveJson(paths.hooksFile, settings);
  console.log(`Installed OpenBox hooks (${paths.scope}) into ${paths.hooksFile}`);
  console.log(`Hook events: ${spec.events.map((e) => e.name).join(", ")}`);
  dropExampleConfig(paths.configDir);
}
function uninstallAdapter(spec, options = {}) {
  const paths = resolveInstallPaths(spec, options);
  const settings = loadJson(paths.hooksFile);
  const hooksBlock = settings[spec.key];
  if (!hooksBlock || typeof hooksBlock !== "object") {
    console.log(`No hooks configured at ${paths.hooksFile}. Nothing to uninstall.`);
    return;
  }
  let removed = 0;
  if (spec.style === "claude-array") {
    const block = hooksBlock;
    for (const evt of Object.keys(block)) {
      const before = block[evt].length;
      block[evt] = block[evt].filter((r) => !ruleIsOpenBox(r, spec.command));
      removed += before - block[evt].length;
      if (block[evt].length === 0) delete block[evt];
    }
    if (Object.keys(block).length === 0) delete settings[spec.key];
  } else {
    const block = hooksBlock;
    for (const evt of spec.events) {
      if (isCursorOpenBoxHook(block[evt.name], spec.command)) {
        delete block[evt.name];
        removed += 1;
      }
    }
    if (Object.keys(block).length === 0) delete settings[spec.key];
  }
  saveJson(paths.hooksFile, settings);
  console.log(`Removed ${removed} OpenBox hook(s) from ${paths.hooksFile}`);
}
function installMcpEntry(spec, serverName, serverEntry, options = {}) {
  const paths = resolveInstallPaths(spec, options);
  const cfg = loadJson(paths.mcpFile);
  const servers = cfg[paths.mcpKey] ?? {};
  servers[serverName] = serverEntry;
  cfg[paths.mcpKey] = servers;
  saveJson(paths.mcpFile, cfg);
  console.log(`Registered MCP server '${serverName}' in ${paths.mcpFile}`);
  return paths.mcpFile;
}
function uninstallMcpEntry(spec, serverName, options = {}) {
  const paths = resolveInstallPaths(spec, options);
  const cfg = loadJson(paths.mcpFile);
  const servers = cfg[paths.mcpKey];
  if (!servers || servers[serverName] === void 0) {
    console.log(`No MCP server '${serverName}' in ${paths.mcpFile}. Nothing to remove.`);
    return paths.mcpFile;
  }
  delete servers[serverName];
  if (Object.keys(servers).length === 0) {
    delete cfg[paths.mcpKey];
  }
  saveJson(paths.mcpFile, cfg);
  console.log(`Removed MCP server '${serverName}' from ${paths.mcpFile}`);
  return paths.mcpFile;
}
export {
  installAdapter,
  installMcpEntry,
  resolveInstallPaths,
  uninstallAdapter,
  uninstallMcpEntry
};
