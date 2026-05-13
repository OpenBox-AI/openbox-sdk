// Single source of truth for env resolution across every OpenBox
// surface running on this machine. CLI, MCP server, cursor hook,
// claude-code hook, and the extension all converge here so they
// agree on which env they're hitting.
//
// The contract:
//
//   ~/.openbox/config is the single source of truth.
//   Every process applies it to process.env on startup
//   (or per-operation, for stateless invocations like hooks).
//
//   Precedence (highest first):
//     1. --env <flag>          (CLI surfaces only; per-invocation)
//     2. process.env.OPENBOX_*  (explicit shell export; per-process)
//     3. ~/.openbox/config      (file-backed default; persistent)
//     4. DEFAULT_ENV            (build-pinned fallback)
//
//   <env>.OPENBOX_API_URL, <env>.OPENBOX_CORE_URL,
//   <env>.OPENBOX_API_KEY can all live in the config file. Storing
//   per-env keys means hooks fire against the right env without the
//   user having to remember to export OPENBOX_API_KEY in every
//   shell or rerun `install cursor` whenever they switch envs.
//
// The extension writes OPENBOX_ENV to this file via its debug-view
// "switch env" action; the CLI's `openbox config set --global` does
// the same. Both reach every other surface automatically.
//
// Long-running daemons (MCP server) call this per-tool to follow the
// file even after a switch; per-event hooks (cursor / claude-code)
// call it per-event for the same reason. Stateless CLI invocations
// call it once at startup.

import {
  applyGlobalConfigToProcessEnv,
  applyConfigToProcessEnv,
} from './config-store.js';
import { resolveEnv, type EnvName } from '../env/index.js';

/** Apply ~/.openbox/config to `process.env` and return the active
 *  env. Idempotent and side-effecting: layered values only fill keys
 *  that aren't already set, so an explicit shell export of
 *  OPENBOX_ENV / OPENBOX_API_KEY / etc. always wins.
 *
 *  Call sites:
 *    - CLI / MCP: at startup
 *    - Cursor hook handler: at the top of `runCursorHook`
 *    - Claude Code hook handler: at the top of `runClaudeHook`
 *    - MCP per-tool refresh (when the daemon needs to follow a
 *      config change without restart): at the top of each tool
 *      action body, before constructing the per-call client. */
export function applyEnvSource(): EnvName {
  applyGlobalConfigToProcessEnv();
  const env = resolveEnv();
  applyConfigToProcessEnv(env);
  return env;
}

/** True when the user has opted into env-internal UI surfaces.
 *  Hides the env picker / active-env labels / --env help / debug
 *  commands by default so end users never see staging or local env
 *  names; switching is still available via `~/.openbox/config` for
 *  power users. Mirrored on the Rust side by
 *  `openbox_sdk::env::is_debug_mode`.
 *
 *  Sources (highest first):
 *    1. `OPENBOX_DEBUG=1|true` env var
 *    2. `~/.openbox/config` global `OPENBOX_DEBUG=true` line
 *
 *  Truthy values: `1`, `true`, `yes`, `on` (case-insensitive). */
export function isDebugMode(): boolean {
  const truthy = (v: string): boolean =>
    ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
  if (process.env.OPENBOX_DEBUG && truthy(process.env.OPENBOX_DEBUG)) return true;
  applyGlobalConfigToProcessEnv();
  const fromCfg = process.env.OPENBOX_DEBUG;
  if (fromCfg && truthy(fromCfg)) return true;
  return false;
}
