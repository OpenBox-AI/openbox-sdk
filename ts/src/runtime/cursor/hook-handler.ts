// Hook handler - invoked by `openbox cursor hook` from Cursor's
// hooks.json config. Reads stdin, dispatches via the spec-driven
// cursor-hooks adapter, returns the appropriate stdout per hook event
// (cursor-permission for before*, cursor-observe for after*), exits 0
// fail-open.
import { createCursorHooksAdapter } from '../../core-client/generated/runtime/cursor-hooks.js';
import { OpenBoxCoreClient } from '../../core-client/index.js';
import { loadConfig } from './config.js';
import { initLogger } from './logger.js';
import { resolveSession } from './session-resolver.js';
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

  await createCursorHooksAdapter({
    core,
    resolveSession: (env) => resolveSession(env, cfg),
    handlers: {
      beforeSubmitPrompt: async (env, s) => dryRun ? undefined : handleBeforeSubmitPrompt(env, s, cfg),
      beforeShellExecution: async (env, s) => dryRun ? undefined : handleBeforeShellExecution(env, s, cfg),
      beforeMCPExecution: async (env, s) => dryRun ? undefined : handleBeforeMCPExecution(env, s, cfg),
      beforeReadFile: async (env, s) => dryRun ? undefined : handleBeforeReadFile(env, s, cfg),
      preToolUse: async (env, s) => dryRun ? undefined : handlePreToolUse(env, s, cfg),
      afterMCPExecution: async (env, s) => dryRun ? undefined : handleAfterMCPExecution(env, s, cfg),
      afterAgentResponse: async (env, s) => dryRun ? undefined : handleAfterAgentResponse(env, s, cfg),
      afterAgentThought: async (env, s) => dryRun ? undefined : handleAfterAgentThought(env, s, cfg),
      afterShellExecution: async (env, s) => dryRun ? undefined : handleAfterShellExecution(env, s, cfg),
      afterFileEdit: async (env, s) => dryRun ? undefined : handleAfterFileEdit(env, s, cfg),
      sessionStart: async (env, s) => dryRun ? undefined : handleSessionStart(env, s, cfg),
      stop: async (env, s) => dryRun ? undefined : handleStop(env, s, cfg),
    },
  }).run();
}
