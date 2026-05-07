// Thin adapter over the SDK's canonical config-store. The CLI's
// `~/.openbox/config` is the single source of truth across CLI, MCP,
// slash commands, and this extension; we delegate parsing/writing
// to the same module the CLI uses so the formats can never drift.
//
// Public exports below match what the rest of the extension imports.

import { getConfig, setConfig } from "openbox-sdk/cli/config-store";
import { ENVIRONMENTS, DEFAULT_ENV, type EnvName } from "openbox-sdk/env";

// Spec-driven env list; collapses if a new env is added to TypeSpec.
const ENVS: ReadonlySet<string> = new Set(Object.keys(ENVIRONMENTS));

/** Active env, resolved with the same precedence the CLI uses:
 *  process.env wins, then global config, then the build-pinned default. */
export function readGlobalEnv(): EnvName {
  const fromEnv = (process.env.OPENBOX_ENV ?? "").toLowerCase();
  if (ENVS.has(fromEnv)) return fromEnv as EnvName;
  const fromCfg = (getConfig("global", "OPENBOX_ENV") ?? "").toLowerCase();
  if (ENVS.has(fromCfg)) return fromCfg as EnvName;
  return DEFAULT_ENV;
}

/** Persist OPENBOX_ENV at global scope so the CLI / MCP / slash
 *  commands resolve to the same env on next invocation. No-op when
 *  the value is unchanged. */
export function writeGlobalEnv(env: EnvName): void {
  if (getConfig("global", "OPENBOX_ENV") === env) return;
  setConfig("global", "OPENBOX_ENV", env);
}
