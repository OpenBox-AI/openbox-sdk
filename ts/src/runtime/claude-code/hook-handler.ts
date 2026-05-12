// Hook handler; invoked by `openbox claude-code hook` from Claude
// Code's hooks.json config. Reads stdin, dispatches via the spec-driven
// claude-code adapter, returns appropriate stdout per hook event,
// exits 0 (fail-open).
import { createClaudeCodeAdapter } from '../../core-client/generated/runtime/claude-code.js';
import { OpenBoxCoreClient } from '../../core-client/index.js';
import { loadConfig } from './config.js';
import { applyEnvSource } from '../../cli/env-source.js';
import { createLogger } from '../../logging/logger.js';
import { resolveSession } from './session-resolver.js';
import { makeHookLog } from '../../logging/hook-log.js';
import { handlePreToolUse } from './mappers/pre-tool-use.js';
import { handlePostToolUse } from './mappers/post-tool-use.js';
import { handleUserPromptSubmit } from './mappers/user-prompt.js';
import { handlePermissionRequest } from './mappers/permission-request.js';
import {
  handleSessionStart,
  handleSessionEnd,
  handleStop,
} from './mappers/session.js';
import { handleSubagentStart, handleSubagentStop } from './mappers/subagent.js';

const hookLog = makeHookLog('claude-code');

/** Wrap a per-event handler with a JSONL log line for the OutputChannel
 *  tail. Mirrors the cursor adapter so the extension can show both
 *  hosts' hook activity through the same code path. */
function logged<E, S, R>(
  event: string,
  verdictKind: 'permission' | 'observe' | 'none',
  fn: (env: E, s: S) => Promise<R>,
): (env: E, s: S) => Promise<R> {
  return async (env, s) => {
    const start = Date.now();
    try {
      const out = await fn(env, s);
      hookLog.record({
        ts: new Date().toISOString(),
        event,
        verdict_kind: verdictKind,
        took_ms: Date.now() - start,
      });
      return out;
    } catch (err: any) {
      hookLog.record({
        ts: new Date().toISOString(),
        event,
        verdict_kind: verdictKind,
        took_ms: Date.now() - start,
        error: String(err?.message ?? err),
      });
      throw err;
    }
  };
}

export async function runClaudeHook(): Promise<void> {
  // Single-source env resolution. Same call CLI / MCP / cursor hook
  // make so every OpenBox process on this machine converges on the
  // active env from ~/.openbox/config.
  applyEnvSource();

  const cfg = loadConfig();
  createLogger('claude-code').initLogger(cfg);

  // Pass-through if not configured. The adapter would still be willing to
  // run but with no API key the core client can't call /evaluate; better to
  // exit cleanly than emit confusing errors.
  if (!cfg.openboxApiKey) {
    if (cfg.verbose) console.error('[openbox claude-code] no OPENBOX_API_KEY set, passing through');
    process.exit(0);
  }

  // Dry-run: handlers immediately return undefined (= allow / no decision).
  // The adapter still writes the right stdout shape per @verdictShape.
  const dryRun = cfg.dryRun;

  const core = new OpenBoxCoreClient({
    apiKey: cfg.openboxApiKey,
    apiUrl: cfg.openboxEndpoint,
    timeoutMs: cfg.governanceTimeout * 1000,
  });

  await createClaudeCodeAdapter({
    core,
    resolveSession: (env) => resolveSession(env, cfg),
    handlers: {
      preToolUse: logged('preToolUse', 'permission',
        async (env, s) => dryRun ? undefined : handlePreToolUse(env, s, cfg)),
      postToolUse: logged('postToolUse', 'observe',
        async (env, s) => dryRun ? undefined : handlePostToolUse(env, s, cfg)),
      userPromptSubmit: logged('userPromptSubmit', 'permission',
        async (env, s) => dryRun ? undefined : handleUserPromptSubmit(env, s, cfg)),
      permissionRequest: logged('permissionRequest', 'permission',
        async (env, s) => dryRun ? undefined : handlePermissionRequest(env, s, cfg)),
      sessionStart: logged('sessionStart', 'none',
        async (env, s) => dryRun ? undefined : handleSessionStart(env, s, cfg)),
      sessionEnd: logged('sessionEnd', 'none',
        async (env, s) => dryRun ? undefined : handleSessionEnd(env, s, cfg)),
      stop: logged('stop', 'observe',
        async (env, s) => dryRun ? undefined : handleStop(env, s, cfg)),
      subagentStart: logged('subagentStart', 'permission',
        async (env, s) => dryRun ? undefined : handleSubagentStart(env, s, cfg)),
      subagentStop: logged('subagentStop', 'observe',
        async (env, s) => dryRun ? undefined : handleSubagentStop(env, s, cfg)),
    },
  }).run();
}
