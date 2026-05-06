// Hook handler; invoked by `openbox cursor hook` from Cursor's
// hooks.json config. Reads stdin, dispatches via the spec-driven
// cursor adapter, returns the appropriate stdout per hook event
// (cursor-permission for before*, cursor-observe for after*), exits 0
// fail-open.
import { createCursorAdapter } from '../../core-client/generated/runtime/cursor.js';
import { OpenBoxCoreClient } from '../../core-client/index.js';
import { loadConfig } from './config.js';
import { initLogger } from './logger.js';
import { resolveSession } from './session-resolver.js';
import { recordHookEvent } from './event-log.js';
import { handleBeforeSubmitPrompt } from './mappers/prompt.js';
import { handleBeforeShellExecution } from './mappers/shell.js';
import { handleBeforeMCPExecution } from './mappers/mcp.js';
import { handleBeforeReadFile } from './mappers/file-read.js';
import { handlePreToolUse } from './mappers/pre-tool-use.js';
import { handleAfterMCPExecution } from './mappers/mcp-response.js';
import {
  handleAfterAgentResponse,
  handleAfterAgentThought,
  handleAfterShellExecution,
  handleAfterFileEdit,
  handleSessionStart,
  handleStop,
} from './mappers/observe.js';

/** Wrap a per-event handler with a JSONL log line for the
 *  OutputChannel tail. Records timing, dispatch outcome (verdict
 *  shape from the spec), and any thrown error. Logging never
 *  breaks the handler: thrown errors are recorded then re-raised.
 *  Generics preserve the original handler's return type so the
 *  spec-emitted adapter's `verdict | undefined` contract isn't
 *  widened to `unknown`. */
function logged<E, S, R>(
  event: string,
  verdictKind: 'permission' | 'observe' | 'none',
  fn: (env: E, s: S) => Promise<R>,
): (env: E, s: S) => Promise<R> {
  return async (env, s) => {
    const start = Date.now();
    try {
      const out = await fn(env, s);
      recordHookEvent({
        ts: new Date().toISOString(),
        event,
        verdict_kind: verdictKind,
        took_ms: Date.now() - start,
      });
      return out;
    } catch (err: any) {
      recordHookEvent({
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

export async function runCursorHook(): Promise<void> {
  const cfg = loadConfig();
  initLogger(cfg);

  if (!cfg.openboxApiKey) {
    if (cfg.verbose) console.error('[openbox cursor] no OPENBOX_API_KEY set, passing through');
    process.exit(0);
  }

  const dryRun = cfg.dryRun;

  const core = new OpenBoxCoreClient({
    apiKey: cfg.openboxApiKey,
    apiUrl: cfg.openboxEndpoint,
    timeoutMs: cfg.governanceTimeout * 1000,
  });

  await createCursorAdapter({
    core,
    resolveSession: (env) => resolveSession(env, cfg),
    handlers: {
      beforeSubmitPrompt: logged('beforeSubmitPrompt', 'permission',
        async (env, s) => dryRun ? undefined : handleBeforeSubmitPrompt(env, s, cfg)),
      beforeShellExecution: logged('beforeShellExecution', 'permission',
        async (env, s) => dryRun ? undefined : handleBeforeShellExecution(env, s, cfg)),
      beforeMCPExecution: logged('beforeMCPExecution', 'permission',
        async (env, s) => dryRun ? undefined : handleBeforeMCPExecution(env, s, cfg)),
      beforeReadFile: logged('beforeReadFile', 'permission',
        async (env, s) => dryRun ? undefined : handleBeforeReadFile(env, s, cfg)),
      preToolUse: logged('preToolUse', 'permission',
        async (env, s) => dryRun ? undefined : handlePreToolUse(env, s, cfg)),
      afterMCPExecution: logged('afterMCPExecution', 'observe',
        async (env, s) => dryRun ? undefined : handleAfterMCPExecution(env, s, cfg)),
      afterAgentResponse: logged('afterAgentResponse', 'observe',
        async (env, s) => dryRun ? undefined : handleAfterAgentResponse(env, s, cfg)),
      afterAgentThought: logged('afterAgentThought', 'observe',
        async (env, s) => dryRun ? undefined : handleAfterAgentThought(env, s, cfg)),
      afterShellExecution: logged('afterShellExecution', 'observe',
        async (env, s) => dryRun ? undefined : handleAfterShellExecution(env, s, cfg)),
      afterFileEdit: logged('afterFileEdit', 'observe',
        async (env, s) => dryRun ? undefined : handleAfterFileEdit(env, s, cfg)),
      sessionStart: logged('sessionStart', 'none',
        async (env, s) => dryRun ? undefined : handleSessionStart(env, s, cfg)),
      stop: logged('stop', 'none',
        async (env, s) => dryRun ? undefined : handleStop(env, s, cfg)),
    },
  }).run();
}
