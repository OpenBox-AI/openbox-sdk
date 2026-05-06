// Single source of truth for OpenBox env across all tools (CLI,
// MCP, slash commands, extension). The CLI persists OPENBOX_ENV
// (and other globals) to ~/.openbox/config; the extension reads
// from the same file here, and syncs writes when the user changes
// the vscode setting. That way:
//
//   - `openbox config set OPENBOX_ENV local` updates the file ->
//     extension picks it up next activation
//   - User changes `openbox.environment` in vscode settings ->
//     extension writes to file -> CLI / MCP / slash commands see
//     the same value on next invocation
//
// We don't go through openbox-sdk's cli/config-store because
// that module isn't a public export; the file format is plain
// `key=value` lines with `#` comments and per-env prefixing
// (`<env>.KEY=...`). Reimplement here to keep the extension
// dependency surface narrow.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { EnvName } from "openbox-sdk/env";

const ENVS: ReadonlySet<string> = new Set(["production", "staging", "local"]);

function configPath(): string {
  // Mirrors the SDK's resolveOsPath('config') for darwin/linux/windows.
  // Keeping it inline here avoids pulling in another SDK subpath.
  const home = process.env.OPENBOX_HOME || path.join(os.homedir(), ".openbox");
  return path.join(home, "config");
}

interface ParsedConfig {
  global: Record<string, string>;
  perEnv: Record<EnvName, Record<string, string>>;
}

function parse(raw: string): ParsedConfig {
  const out: ParsedConfig = {
    global: {},
    perEnv: { production: {}, staging: {}, local: {} },
  };
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (!k) continue;
    const dot = k.indexOf(".");
    if (dot > 0) {
      const envCandidate = k.slice(0, dot);
      const innerKey = k.slice(dot + 1);
      if (ENVS.has(envCandidate)) {
        out.perEnv[envCandidate as EnvName][innerKey] = v;
        continue;
      }
    }
    out.global[k] = v;
  }
  return out;
}

function serialize(cfg: ParsedConfig): string {
  const lines: string[] = [
    "# OpenBox CLI config; managed by `openbox config set/get/unset/list`.",
    "# Two scopes: lines without a prefix are global; lines like",
    "# `staging.OPENBOX_API_URL=...` are per-env (production / staging / local).",
  ];
  // Global keys, sorted.
  for (const k of Object.keys(cfg.global).sort()) {
    lines.push(`${k}=${cfg.global[k]}`);
  }
  // Per-env keys, sorted by env then key.
  for (const env of ["local", "staging", "production"] as const) {
    const inner = cfg.perEnv[env];
    for (const k of Object.keys(inner).sort()) {
      lines.push(`${env}.${k}=${inner[k]}`);
    }
  }
  return lines.join("\n") + "\n";
}

function readConfig(): ParsedConfig {
  const p = configPath();
  if (!fs.existsSync(p)) return { global: {}, perEnv: { production: {}, staging: {}, local: {} } };
  try {
    return parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return { global: {}, perEnv: { production: {}, staging: {}, local: {} } };
  }
}

function writeConfig(cfg: ParsedConfig): void {
  const p = configPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, serialize(cfg), { mode: 0o600 });
}

/** Read OPENBOX_ENV from the config file's global scope, falling
 *  back to `process.env.OPENBOX_ENV` and finally `production`. This
 *  mirrors what the CLI's `resolveEnv()` ends up with after its
 *  preAction `applyGlobalConfigToProcessEnv()` step, so the
 *  extension and the CLI agree on what env they're running in. */
export function readGlobalEnv(): EnvName {
  // 1. Process env (set by CLI flag --env or shell export).
  const fromEnv = (process.env.OPENBOX_ENV ?? "").toLowerCase();
  if (fromEnv && ENVS.has(fromEnv)) return fromEnv as EnvName;
  // 2. Config file global scope.
  const cfg = readConfig();
  const fromCfg = cfg.global.OPENBOX_ENV?.toLowerCase();
  if (fromCfg && ENVS.has(fromCfg)) return fromCfg as EnvName;
  // 3. Default.
  return "production";
}

/** Persist OPENBOX_ENV to the config file's global scope. The CLI,
 *  MCP server, and any subprocess that loads the file will pick it
 *  up next time they read it. */
export function writeGlobalEnv(env: EnvName): void {
  const cfg = readConfig();
  if (cfg.global.OPENBOX_ENV === env) return;
  cfg.global.OPENBOX_ENV = env;
  writeConfig(cfg);
}
